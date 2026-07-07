import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Candidate } from '../models/candidate.model';
import { SearchRequestDto } from '../dto/search-request.dto';
import { deriveTerms } from '../providers/query.util';

interface LlmVerdict {
  id: string;
  score: number;
  reasoning: string;
}

/**
 * Scores and explains how well each candidate matches the requirements.
 *
 * Primary path: a single Claude call that ranks the whole batch and returns a
 * short justification per candidate. If no ANTHROPIC_API_KEY is configured, or
 * the call fails, it degrades gracefully to deterministic keyword scoring so
 * the endpoint always returns ranked results.
 */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);
  private readonly client?: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.model =
      config.get<string>('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001';
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — using keyword-based ranking fallback.',
      );
    }
  }

  /** Which engine will be used for ranking, for reporting to the client. */
  get engine(): 'claude' | 'keywords' {
    return this.client ? 'claude' : 'keywords';
  }

  async rank(candidates: Candidate[], req: SearchRequestDto): Promise<Candidate[]> {
    if (!candidates.length) return [];

    let ranked: Candidate[];
    if (this.client) {
      try {
        ranked = await this.rankWithClaude(candidates, req);
      } catch (err) {
        this.logger.warn(
          `Claude ranking failed (${err instanceof Error ? err.message : err}). Falling back to keyword scoring.`,
        );
        ranked = this.rankByKeywords(candidates, req);
      }
    } else {
      ranked = this.rankByKeywords(candidates, req);
    }

    return ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // --- Claude path ---------------------------------------------------------

  private async rankWithClaude(
    candidates: Candidate[],
    req: SearchRequestDto,
  ): Promise<Candidate[]> {
    const compact = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      headline: c.headline ?? '',
      location: c.location ?? '',
      skills: c.skills,
      snippet: (c.snippet ?? '').slice(0, 400),
      source: c.source,
    }));

    const prompt = [
      'You are a technical sourcer. Score how well each candidate matches the hiring requirements.',
      '',
      'REQUIREMENTS:',
      req.requirements,
      req.keywords?.length ? `\nKEY SKILLS: ${req.keywords.join(', ')}` : '',
      req.location ? `\nLOCATION PREFERENCE: ${req.location}` : '',
      '',
      'CANDIDATES (JSON):',
      JSON.stringify(compact),
      '',
      'For each candidate return an object {"id", "score" (0-100 integer), "reasoning" (one concise sentence, max 200 chars)}.',
      'Score on evidence only; penalize thin or unrelated profiles. Do not invent facts.',
      'Respond with ONLY a JSON array, no markdown, no prose.',
    ].join('\n');

    const res = await this.client!.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const verdicts = this.parseVerdicts(text);
    const byId = new Map(verdicts.map((v) => [v.id, v]));

    return candidates.map((c) => {
      const v = byId.get(c.id);
      return {
        ...c,
        score: v ? clampScore(v.score) : this.keywordScore(c, req),
        reasoning: v?.reasoning?.trim() || undefined,
      };
    });
  }

  private parseVerdicts(text: string): LlmVerdict[] {
    // Be tolerant: extract the first JSON array even if wrapped in fences.
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {
      throw new Error('No JSON array in model response');
    }
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('Model response is not an array');
    return parsed
      .filter((v) => v && typeof v.id === 'string')
      .map((v) => ({
        id: v.id,
        score: Number(v.score) || 0,
        reasoning: typeof v.reasoning === 'string' ? v.reasoning : '',
      }));
  }

  // --- Keyword fallback ----------------------------------------------------

  private rankByKeywords(candidates: Candidate[], req: SearchRequestDto): Candidate[] {
    return candidates.map((c) => {
      const score = this.keywordScore(c, req);
      return {
        ...c,
        score,
        reasoning: c.skills.length
          ? `Matched on ${c.skills.join(', ')} (keyword scoring — enable Claude for richer analysis).`
          : 'Keyword scoring — no strong signal found. Enable Claude for richer analysis.',
      };
    });
  }

  private keywordScore(c: Candidate, req: SearchRequestDto): number {
    const terms = deriveTerms(req, 10).map((t) => t.toLowerCase());
    if (!terms.length) return 0;
    const haystack = [c.name, c.headline, c.location, c.snippet, ...c.skills]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const hits = terms.filter((t) => haystack.includes(t)).length;
    const base = Math.round((hits / terms.length) * 90);
    // Small boost for having a location match when one is requested.
    const locBoost =
      req.location && (c.location ?? '').toLowerCase().includes(req.location.toLowerCase())
        ? 10
        : 0;
    return clampScore(base + locBoost);
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { Candidate } from '../models/candidate.model';
import { SearchRequestDto } from '../dto/search-request.dto';
import { deriveTerms } from '../providers/query.util';

interface LlmVerdict {
  id: string;
  score: number;
  reasoning: string;
}

export type RankingEngine = 'claude' | 'gemini' | 'keywords';

/**
 * Scores and explains how well each candidate matches the requirements.
 *
 * Picks an LLM by whichever key is configured — Anthropic (Claude) if present,
 * otherwise Google Gemini (has a no-credit-card free tier). If neither key is
 * set, or the LLM call fails, it degrades gracefully to deterministic keyword
 * scoring so the endpoint always returns ranked results.
 */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);
  private readonly engineKind: RankingEngine;

  private readonly anthropic?: Anthropic;
  private readonly anthropicModel: string;

  private readonly gemini?: GenerativeModel;
  private readonly geminiModelName: string;

  constructor(config: ConfigService) {
    const anthropicKey = config.get<string>('ANTHROPIC_API_KEY');
    const geminiKey =
      config.get<string>('GEMINI_API_KEY') ||
      config.get<string>('GOOGLE_API_KEY');

    this.anthropicModel =
      config.get<string>('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001';
    this.geminiModelName =
      config.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';

    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
      this.engineKind = 'claude';
    } else if (geminiKey) {
      this.gemini = new GoogleGenerativeAI(geminiKey).getGenerativeModel({
        model: this.geminiModelName,
      });
      this.engineKind = 'gemini';
    } else {
      this.engineKind = 'keywords';
      this.logger.warn(
        'No LLM key (ANTHROPIC_API_KEY / GEMINI_API_KEY) set — using keyword-based ranking fallback.',
      );
    }
  }

  /** Which engine will be used for ranking, for reporting to the client. */
  get engine(): RankingEngine {
    return this.engineKind;
  }

  async rank(candidates: Candidate[], req: SearchRequestDto): Promise<Candidate[]> {
    if (!candidates.length) return [];

    let ranked: Candidate[];
    try {
      if (this.engineKind === 'claude') {
        ranked = await this.rankWithLlm(candidates, req, (p) => this.callClaude(p));
      } else if (this.engineKind === 'gemini') {
        ranked = await this.rankWithLlm(candidates, req, (p) => this.callGemini(p));
      } else {
        ranked = this.rankByKeywords(candidates, req);
      }
    } catch (err) {
      this.logger.warn(
        `${this.engineKind} ranking failed (${err instanceof Error ? err.message : err}). Falling back to keyword scoring.`,
      );
      ranked = this.rankByKeywords(candidates, req);
    }

    return ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // --- LLM path (shared) ---------------------------------------------------

  private async rankWithLlm(
    candidates: Candidate[],
    req: SearchRequestDto,
    call: (prompt: string) => Promise<string>,
  ): Promise<Candidate[]> {
    const prompt = this.buildPrompt(candidates, req);
    const text = await call(prompt);

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

  private buildPrompt(candidates: Candidate[], req: SearchRequestDto): string {
    const compact = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      headline: c.headline ?? '',
      location: c.location ?? '',
      skills: c.skills,
      snippet: (c.snippet ?? '').slice(0, 400),
      source: c.source,
    }));

    return [
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
  }

  private async callClaude(prompt: string): Promise<string> {
    const res = await this.anthropic!.messages.create({
      model: this.anthropicModel,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private async callGemini(prompt: string): Promise<string> {
    const res = await this.gemini!.generateContent(prompt);
    return res.response.text();
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
          ? `Matched on ${c.skills.join(', ')} (keyword scoring — add an LLM key for richer analysis).`
          : 'Keyword scoring — no strong signal found. Add an LLM key for richer analysis.',
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

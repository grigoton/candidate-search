import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SearchRequestDto } from '../dto/search-request.dto';
import { Candidate } from '../models/candidate.model';
import { SourceProvider } from './source-provider.interface';
import { deriveTerms } from './query.util';

/** Normalized organic search hit shared by both backends. */
interface OrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  thumbnail?: string;
}

type WebBackend = 'serper' | 'serpapi' | 'none';

/**
 * "Web" source: an X-ray search over public profile pages via a Google search
 * API. Supports two backends, chosen by whichever key is configured:
 *   - Serper.dev  (SERPER_API_KEY)  — free tier, no credit card required
 *   - SerpAPI     (SERPAPI_KEY)     — free tier available
 *
 * Legal note: X-ray search returns publicly indexed pages. Bulk collection of
 * data from sites like LinkedIn violates their Terms of Service — this provider
 * targets developer-friendly, X-ray-safe sites by default. Adjust XRAY_SITES
 * to your compliance posture.
 *
 * With no key configured the source is simply skipped (returns []). It never
 * fabricates candidates — results are always real.
 */
@Injectable()
export class WebProvider implements SourceProvider {
  readonly key = 'web' as const;
  private readonly logger = new Logger(WebProvider.name);

  private readonly backend: WebBackend;
  private readonly serperKey?: string;
  private readonly serpApiKey?: string;

  /** Sites that are generally safe to X-ray for public professional profiles. */
  private static readonly XRAY_SITES = [
    'github.io',
    'stackoverflow.com/users',
    'dev.to',
    'medium.com',
    'gitlab.com',
  ];

  constructor(config: ConfigService) {
    this.serperKey = config.get<string>('SERPER_API_KEY') || undefined;
    this.serpApiKey = config.get<string>('SERPAPI_KEY') || undefined;
    this.backend = this.serperKey ? 'serper' : this.serpApiKey ? 'serpapi' : 'none';
  }

  isEnabled(): boolean {
    return true; // Skips itself (returns []) when no backend key is configured.
  }

  async search(req: SearchRequestDto): Promise<Candidate[]> {
    const terms = deriveTerms(req);
    if (!terms.length) return [];

    if (this.backend === 'none') {
      this.logger.warn(
        'No web-search key (SERPER_API_KEY / SERPAPI_KEY) set — skipping web source.',
      );
      return [];
    }

    const q = this.buildXrayQuery(terms, req.location);
    const num = Math.min(req.limit ?? 15, 20);

    try {
      const results =
        this.backend === 'serper'
          ? await this.searchSerper(q, num)
          : await this.searchSerpApi(q, num);
      return results
        .filter((r) => r.link && r.title)
        .map((r) => this.toCandidate(r, terms));
    } catch (err) {
      this.logger.warn(
        `${this.backend} search failed: ${this.describeError(err)}. Returning no web results.`,
      );
      return [];
    }
  }

  private async searchSerper(q: string, num: number): Promise<OrganicResult[]> {
    const { data } = await axios.post(
      'https://google.serper.dev/search',
      { q, num },
      {
        timeout: 15_000,
        headers: { 'X-API-KEY': this.serperKey!, 'Content-Type': 'application/json' },
      },
    );
    return (data?.organic ?? []) as OrganicResult[];
  }

  private async searchSerpApi(q: string, num: number): Promise<OrganicResult[]> {
    const { data } = await axios.get('https://serpapi.com/search.json', {
      timeout: 15_000,
      params: { engine: 'google', q, num, api_key: this.serpApiKey },
    });
    return (data?.organic_results ?? []) as OrganicResult[];
  }

  private buildXrayQuery(terms: string[], location?: string): string {
    const sites = WebProvider.XRAY_SITES.map((s) => `site:${s}`).join(' OR ');
    const stack = terms.map((t) => `"${t}"`).join(' ');
    const loc = location && location.toLowerCase() !== 'remote' ? ` "${location}"` : '';
    return `(${sites}) ${stack}${loc}`;
  }

  private toCandidate(r: OrganicResult, terms: string[]): Candidate {
    const text = `${r.title ?? ''} ${r.snippet ?? ''}`;
    return {
      id: `web:${r.link}`,
      name: this.cleanTitle(r.title ?? 'Unknown'),
      headline: r.snippet || undefined,
      url: r.link!,
      source: 'web',
      avatarUrl: r.thumbnail,
      skills: terms.filter((t) => text.toLowerCase().includes(t.toLowerCase())),
      snippet: r.snippet || undefined,
    };
  }

  private cleanTitle(title: string): string {
    // Strip common " - Site" / " | Site" suffixes.
    return title.split(/\s[|–-]\s/)[0].trim().slice(0, 120);
  }

  private describeError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const msg =
        (err.response?.data as { error?: string })?.error ??
        (err.response?.data as { message?: string })?.message;
      return `${status ?? ''} ${msg ?? err.message}`.trim();
    }
    return err instanceof Error ? err.message : String(err);
  }
}

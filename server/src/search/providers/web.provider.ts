import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { SearchRequestDto } from '../dto/search-request.dto';
import { Candidate } from '../models/candidate.model';
import { SourceProvider } from './source-provider.interface';
import { deriveTerms } from './query.util';

interface SerpOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  thumbnail?: string;
}

/**
 * "Web" source: an X-ray search over public profile pages via SerpAPI (Google).
 *
 * Legal note: X-ray search returns publicly indexed pages. Bulk collection of
 * data from sites like LinkedIn violates their Terms of Service — this provider
 * targets developer-friendly, X-ray-safe sites by default. Adjust XRAY_SITES
 * to your compliance posture.
 *
 * Without SERPAPI_KEY the provider returns clearly-labeled demo results so the
 * UI is usable end-to-end before you wire real credentials.
 */
@Injectable()
export class WebProvider implements SourceProvider {
  readonly key = 'web' as const;
  private readonly logger = new Logger(WebProvider.name);
  private readonly http: AxiosInstance;
  private readonly apiKey?: string;

  /** Sites that are generally safe to X-ray for public professional profiles. */
  private static readonly XRAY_SITES = [
    'github.io',
    'stackoverflow.com/users',
    'dev.to',
    'medium.com',
    'gitlab.com',
  ];

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('SERPAPI_KEY') || undefined;
    this.http = axios.create({
      baseURL: 'https://serpapi.com',
      timeout: 15_000,
    });
  }

  isEnabled(): boolean {
    return true; // Falls back to demo data when no key is configured.
  }

  async search(req: SearchRequestDto): Promise<Candidate[]> {
    const terms = deriveTerms(req);
    if (!terms.length) return [];

    if (!this.apiKey) {
      this.logger.warn(
        'SERPAPI_KEY not set — skipping web source. Set the key to enable real X-ray search.',
      );
      return [];
    }

    const q = this.buildXrayQuery(terms, req.location);
    try {
      const { data } = await this.http.get('/search.json', {
        params: {
          engine: 'google',
          q,
          num: Math.min(req.limit ?? 15, 20),
          api_key: this.apiKey,
        },
      });
      const results: SerpOrganicResult[] = data?.organic_results ?? [];
      return results
        .filter((r) => r.link && r.title)
        .map((r, i) => this.toCandidate(r, i, terms));
    } catch (err) {
      this.logger.warn(
        `SerpAPI search failed: ${this.describeError(err)}. Returning no web results.`,
      );
      return [];
    }
  }

  private buildXrayQuery(terms: string[], location?: string): string {
    const sites = WebProvider.XRAY_SITES.map((s) => `site:${s}`).join(' OR ');
    const stack = terms.map((t) => `"${t}"`).join(' ');
    const loc = location && location.toLowerCase() !== 'remote' ? ` "${location}"` : '';
    return `(${sites}) ${stack}${loc}`;
  }

  private toCandidate(r: SerpOrganicResult, i: number, terms: string[]): Candidate {
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
      const msg = (err.response?.data as { error?: string })?.error;
      return `${status ?? ''} ${msg ?? err.message}`.trim();
    }
    return err instanceof Error ? err.message : String(err);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { SearchRequestDto } from '../dto/search-request.dto';
import { Candidate } from '../models/candidate.model';
import { SourceProvider } from './source-provider.interface';
import { deriveTerms } from './query.util';

interface GithubSearchItem {
  login: string;
  html_url: string;
  avatar_url: string;
  url: string;
}

interface GithubUserDetail {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  blog: string | null;
  company: string | null;
  html_url: string;
  avatar_url: string;
}

/**
 * Free, legal candidate source. Uses the GitHub user search API, biasing by
 * language and location, then enriches the top hits with profile details.
 *
 * GitHub's `language:` qualifier on user search ranks users by the languages
 * of their repositories — a decent proxy for a developer's stack.
 */
@Injectable()
export class GithubProvider implements SourceProvider {
  readonly key = 'github' as const;
  private readonly logger = new Logger(GithubProvider.name);
  private readonly http: AxiosInstance;
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('GITHUB_TOKEN') || undefined;
    this.http = axios.create({
      baseURL: 'https://api.github.com',
      timeout: 12_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
  }

  /** GitHub search works without a token (just rate-limited), so always on. */
  isEnabled(): boolean {
    return true;
  }

  async search(req: SearchRequestDto): Promise<Candidate[]> {
    const terms = deriveTerms(req);
    if (!terms.length) return [];

    const q = this.buildQuery(terms, req.location);
    const perPage = Math.min(req.limit ?? 15, 20);

    try {
      const { data } = await this.http.get('/search/users', {
        params: { q, per_page: perPage },
      });
      const items: GithubSearchItem[] = data?.items ?? [];
      if (!items.length) return [];

      // Enrich in parallel but cap concurrency implicitly via slice.
      const details = await Promise.all(
        items.map((it) => this.fetchDetail(it.login)),
      );

      return details
        .filter((d): d is GithubUserDetail => !!d)
        .map((d) => this.toCandidate(d, terms));
    } catch (err) {
      this.logger.warn(
        `GitHub search failed: ${this.describeError(err)}. Returning no GitHub results.`,
      );
      return [];
    }
  }

  private buildQuery(terms: string[], location?: string): string {
    // First term as the primary language qualifier, the rest as free text.
    const [primary, ...rest] = terms;
    const parts = [primary, ...rest.map((t) => `${t}`)];
    let q = parts.join(' ');
    q += ` language:${primary}`;
    if (location && location.toLowerCase() !== 'remote') {
      q += ` location:${JSON.stringify(location)}`;
    }
    q += ' type:user';
    return q;
  }

  private async fetchDetail(login: string): Promise<GithubUserDetail | null> {
    try {
      const { data } = await this.http.get(`/users/${login}`);
      return data as GithubUserDetail;
    } catch (err) {
      this.logger.debug(`GitHub detail for ${login} failed: ${this.describeError(err)}`);
      return null;
    }
  }

  private toCandidate(d: GithubUserDetail, terms: string[]): Candidate {
    const snippet = [d.bio, d.company].filter(Boolean).join(' · ');
    return {
      id: `github:${d.login}`,
      name: d.name || d.login,
      headline: d.bio || undefined,
      url: d.html_url,
      source: 'github',
      avatarUrl: d.avatar_url,
      location: d.location || undefined,
      // Best-effort: surface the queried terms that appear in the bio.
      skills: terms.filter((t) =>
        (snippet || '').toLowerCase().includes(t.toLowerCase()),
      ),
      snippet: snippet || undefined,
    };
  }

  private describeError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const msg = (err.response?.data as { message?: string })?.message;
      return `${status ?? ''} ${msg ?? err.message}`.trim();
    }
    return err instanceof Error ? err.message : String(err);
  }
}

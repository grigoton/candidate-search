import { Inject, Injectable, Logger } from '@nestjs/common';
import { SearchRequestDto } from './dto/search-request.dto';
import { Candidate } from './models/candidate.model';
import { RankingService } from './ranking/ranking.service';
import { SOURCE_PROVIDERS, SourceProvider } from './providers/source-provider.interface';

export interface SearchResponse {
  query: {
    requirements: string;
    keywords: string[];
    location?: string;
    sources: string[];
  };
  count: number;
  rankedBy: 'claude' | 'gemini' | 'keywords';
  candidates: Candidate[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(SOURCE_PROVIDERS) private readonly providers: SourceProvider[],
    private readonly ranking: RankingService,
  ) {}

  async search(req: SearchRequestDto): Promise<SearchResponse> {
    const active = this.providers.filter(
      (p) => req.sources.includes(p.key) && p.isEnabled(),
    );

    // Query all requested sources concurrently; a failing source yields [].
    const results = await Promise.all(
      active.map(async (p) => {
        try {
          return await p.search(req);
        } catch (err) {
          this.logger.warn(
            `Provider "${p.key}" threw: ${err instanceof Error ? err.message : err}`,
          );
          return [] as Candidate[];
        }
      }),
    );

    const merged = this.dedupe(results.flat());
    const ranked = await this.ranking.rank(merged, req);
    const limited = ranked.slice(0, req.limit ?? 15);

    return {
      query: {
        requirements: req.requirements,
        keywords: req.keywords ?? [],
        location: req.location,
        sources: req.sources,
      },
      count: limited.length,
      rankedBy: this.ranking.engine,
      candidates: limited,
    };
  }

  private dedupe(candidates: Candidate[]): Candidate[] {
    const seen = new Map<string, Candidate>();
    for (const c of candidates) {
      const key = c.url.toLowerCase();
      if (!seen.has(key)) seen.set(key, c);
    }
    return [...seen.values()];
  }
}

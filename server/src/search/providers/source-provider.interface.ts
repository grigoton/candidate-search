import { Candidate } from '../models/candidate.model';
import { SearchRequestDto } from '../dto/search-request.dto';

/**
 * A pluggable candidate source. Implementations translate the generic search
 * request into a provider-specific query and return normalized candidates.
 *
 * Providers must be resilient: on missing credentials or upstream errors they
 * should return an empty array (and log), never throw, so one failing source
 * never breaks the whole search.
 */
export interface SourceProvider {
  /** Matches SearchRequestDto.sources entries. */
  readonly key: 'github' | 'web';
  /** Whether the provider is usable given current configuration. */
  isEnabled(): boolean;
  search(req: SearchRequestDto): Promise<Candidate[]>;
}

export const SOURCE_PROVIDERS = 'SOURCE_PROVIDERS';

/**
 * Normalized candidate shape returned by every source provider and enriched
 * by the ranking service. Keep this provider-agnostic so the frontend never
 * needs to know where a candidate came from.
 */
export interface Candidate {
  /** Stable id, unique within a single search response. */
  id: string;
  /** Display name or handle. */
  name: string;
  /** Short headline / bio / role line. */
  headline?: string;
  /** Public profile URL. */
  url: string;
  /** Which provider surfaced this candidate. */
  source: CandidateSource;
  avatarUrl?: string;
  location?: string;
  /** Extracted / inferred skills, best-effort. */
  skills: string[];
  /** Raw text snippet used for matching (bio, search snippet, etc.). */
  snippet?: string;

  // --- Filled in by RankingService ---
  /** Relevance score 0-100. */
  score?: number;
  /** Human-readable explanation of why the candidate matches. */
  reasoning?: string;
}

export type CandidateSource = 'github' | 'web';

export type CandidateSource = 'github' | 'web';

export interface Candidate {
  id: string;
  name: string;
  headline?: string;
  url: string;
  source: CandidateSource;
  avatarUrl?: string;
  location?: string;
  skills: string[];
  snippet?: string;
  score?: number;
  reasoning?: string;
}

export interface SearchRequest {
  requirements: string;
  keywords: string[];
  location?: string;
  sources: CandidateSource[];
  limit?: number;
}

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

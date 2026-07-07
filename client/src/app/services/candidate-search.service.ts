import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SearchRequest, SearchResponse } from '../models/candidate';

/**
 * Resolves the backend base URL:
 *  - `window.API_BASE` if the host page sets it (e.g. injected at deploy time);
 *  - `http://localhost:3000` when running under `ng serve` (port 4200);
 *  - same-origin (empty prefix) otherwise, assuming a reverse proxy to /api.
 */
function resolveApiBase(): string {
  const override = (globalThis as { API_BASE?: string }).API_BASE;
  if (override) return override.replace(/\/$/, '');
  if (typeof location !== 'undefined' && location.port === '4200') {
    return 'http://localhost:3000';
  }
  return '';
}

@Injectable({ providedIn: 'root' })
export class CandidateSearchService {
  private readonly http = inject(HttpClient);
  private readonly base = resolveApiBase();

  search(req: SearchRequest): Observable<SearchResponse> {
    return this.http.post<SearchResponse>(`${this.base}/api/search`, req);
  }
}

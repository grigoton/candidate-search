import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CandidateSearchService } from '../services/candidate-search.service';
import { Candidate, CandidateSource, SearchResponse } from '../models/candidate';

@Component({
  selector: 'app-search',
  imports: [FormsModule],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class Search {
  private readonly api = inject(CandidateSearchService);

  // --- Form state ---
  requirements = '';
  keywordsInput = '';
  location = '';
  useGithub = true;
  useWeb = true;
  limit = 15;

  // --- Async state ---
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly response = signal<SearchResponse | null>(null);

  readonly candidates = computed(() => this.response()?.candidates ?? []);
  readonly rankedBy = computed(() => this.response()?.rankedBy ?? null);

  private get sources(): CandidateSource[] {
    const s: CandidateSource[] = [];
    if (this.useGithub) s.push('github');
    if (this.useWeb) s.push('web');
    return s;
  }

  get canSubmit(): boolean {
    return (
      this.requirements.trim().length > 0 &&
      this.sources.length > 0 &&
      !this.loading()
    );
  }

  submit(): void {
    if (!this.canSubmit) return;
    const keywords = this.keywordsInput
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    this.loading.set(true);
    this.error.set(null);
    this.response.set(null);

    this.api
      .search({
        requirements: this.requirements.trim(),
        keywords,
        location: this.location.trim() || undefined,
        sources: this.sources,
        limit: this.limit,
      })
      .subscribe({
        next: (res) => {
          this.response.set(res);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(
            err?.error?.message
              ? Array.isArray(err.error.message)
                ? err.error.message.join('; ')
                : err.error.message
              : 'Не удалось выполнить поиск. Проверьте, что backend запущен.',
          );
          this.loading.set(false);
        },
      });
  }

  scoreClass(c: Candidate): string {
    const s = c.score ?? 0;
    if (s >= 75) return 'score--high';
    if (s >= 45) return 'score--mid';
    return 'score--low';
  }

  trackById = (_: number, c: Candidate) => c.id;
}

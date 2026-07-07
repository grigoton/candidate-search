import { SearchRequestDto } from '../dto/search-request.dto';

/** Common stop words we don't want to treat as skill keywords. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'to', 'is',
  'are', 'we', 'you', 'who', 'looking', 'candidate', 'candidates', 'experience',
  'years', 'strong', 'good', 'great', 'must', 'have', 'senior', 'junior', 'middle',
  'developer', 'engineer', 'знание', 'опыт', 'лет', 'года', 'ищем', 'кандидат',
]);

/**
 * Derive a compact list of search terms from the request. Prefers explicit
 * keywords; falls back to salient words extracted from the requirements text.
 */
export function deriveTerms(req: SearchRequestDto, max = 6): string[] {
  const explicit = (req.keywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  if (explicit.length) {
    return dedupe(explicit).slice(0, max);
  }

  const fromText = (req.requirements ?? '')
    .toLowerCase()
    .split(/[^a-zа-я0-9+#.]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  return dedupe(fromText).slice(0, max);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s))];
}

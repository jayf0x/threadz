// Frontend relevance ranking for search. The backend ranks matches with SQLite FTS5's bm25()
// (backend/db.ts); porting that — a trigram index plus bm25 — into TypeScript for the device copy
// and the disposable mirror would be overkill for how little data either holds at personal-note
// scale. This is a small heuristic instead, not a bm25 equivalent: title matches always outrank
// content-only matches, and within a bucket more occurrences and an earlier match position rank
// higher. Shared here so local.ts and visibleThreads.ts don't each reinvent the same scoring.

const TITLE_BONUS = 1_000_000;

// Score one haystack against a lowercase needle: null if it doesn't match, otherwise higher means
// more relevant. More occurrences and an earlier first match both raise the score.
export const matchScore = (haystack: string, needle: string): number | null => {
  const hay = haystack.toLowerCase();
  const first = hay.indexOf(needle);
  if (first < 0) return null;
  let count = 0;
  for (let i = first; i >= 0; i = hay.indexOf(needle, i + needle.length)) count++;
  return count * 1000 - first;
};

// A title match always outranks a content-only match. `contentScore` is either a raw `matchScore`
// (when the caller has the text to score itself) or a synthetic score derived from an
// already-ranked list of content hits (e.g. `-position`, so an earlier hit ranks higher).
export const combineScore = (titleScore: number | null, contentScore: number | null): number | null =>
  titleScore != null ? TITLE_BONUS + titleScore : contentScore;

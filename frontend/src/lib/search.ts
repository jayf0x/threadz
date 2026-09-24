// Frontend relevance ranking for search. The backend ranks matches with SQLite FTS5's bm25()
// (backend/db.ts); porting that — a trigram index plus bm25 — into TypeScript for the device copy
// and the disposable mirror would be overkill for how little data either holds at personal-note
// scale. This is a small heuristic instead, not a bm25 equivalent: title matches always outrank
// content-only matches, and within a bucket more occurrences and an earlier match position rank
// higher. Shared here so local.ts and visibleThreads.ts don't each reinvent the same scoring.
//
// Matching is tiered: an exact substring always wins (the original exact-only matcher, unchanged);
// failing that, every needle word must fuzzily match some haystack word, in any order — a typo'd or
// partial word still counts (edit distance, or plain containment) — so a typo or word-order swap
// still surfaces the right thread instead of nothing.

const TITLE_BONUS = 1_000_000;
const FUZZY_CEILING = 1000;

// Restricted Damerau-Levenshtein: a substitution, insertion, deletion or one adjacent transposition
// each cost 1 (a transposed pair — "hte" for "the" — is the single most common typo, and plain
// Levenshtein would otherwise charge it 2). Capped at `max`: once a row's smallest value exceeds it
// the true distance can only be larger, so this returns early instead of finishing the table.
const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let val = Math.min((prev[j] ?? Infinity) + 1, (cur[j - 1] ?? Infinity) + 1, (prev[j - 1] ?? Infinity) + cost);
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        val = Math.min(val, (prevPrev[j - 2] ?? Infinity) + 1);
      }
      cur.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
};

const wordsOf = (s: string): string[] => s.split(/[^a-z0-9]+/).filter(Boolean);

// How many edits still count as "the same word" — proportional to length, since one typo changes a
// 3-letter word far more than it changes a 10-letter one. Shorter than that, a word is too short to
// fuzz without matching almost anything, so it must appear as-is (or as a prefix/substring).
const typoBudget = (word: string): number => (word.length >= 8 ? 2 : 1);

// Every needle word must match some haystack word, in any order: as a substring of it (also covers
// an exact word match, and a partial word like "rese" finding "research"), or within its typo
// budget. Returns null the moment one needle word finds nothing, since a partial phrase isn't a
// match.
const fuzzyScore = (hay: string, needle: string): number | null => {
  const needleWords = wordsOf(needle);
  const hayWords = wordsOf(hay);
  if (needleWords.length === 0 || hayWords.length === 0) return null;

  let totalDistance = 0;
  for (const nw of needleWords) {
    if (nw.length < 3) {
      if (!hayWords.some((hw) => hw.includes(nw))) return null;
      continue;
    }
    const budget = typoBudget(nw);
    let best = budget + 1;
    for (const hw of hayWords) {
      const d = hw.includes(nw) ? 0 : editDistance(nw, hw, budget);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > budget) return null;
    totalDistance += best;
  }
  return FUZZY_CEILING - totalDistance * 100;
};

// Score one haystack against a lowercase needle: null if it doesn't match, otherwise higher means
// more relevant. An exact substring (more occurrences, earlier position) always outranks a fuzzy
// one; see fuzzyScore above for what counts as fuzzy.
export const matchScore = (haystack: string, needle: string): number | null => {
  const hay = haystack.toLowerCase();
  const q = needle.toLowerCase();
  const first = hay.indexOf(q);
  if (first >= 0) {
    let count = 0;
    for (let i = first; i >= 0; i = hay.indexOf(q, i + q.length)) count++;
    return count * 1000 - first;
  }
  return fuzzyScore(hay, q);
};

// A title match always outranks a content-only match. `contentScore` is either a raw `matchScore`
// (when the caller has the text to score itself) or a synthetic score derived from an
// already-ranked list of content hits (e.g. `-position`, so an earlier hit ranks higher).
export const combineScore = (titleScore: number | null, contentScore: number | null): number | null =>
  titleScore != null ? TITLE_BONUS + titleScore : contentScore;

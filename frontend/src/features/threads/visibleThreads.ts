import { combineScore, matchScore } from "@/lib/search";
import type { Thread } from "@/lib/types";

export const SORTS = [
  { value: "updated", label: "Recent" },
  { value: "created", label: "Newest" },
  { value: "title", label: "A–Z" },
] as const;

export type Sort = (typeof SORTS)[number]["value"];

export const isSort = (v: string): v is Sort => SORTS.some((s) => s.value === v);

// The index as the user sees it: filtered by the search box, then ordered. `contentHits` maps a
// thread id to its position in the API's own results (only the API can tell a note matches: the
// mirror holds no note text until a thread is opened) — lower is more relevant.
export const visibleThreads = (
  threads: Thread[],
  query: string,
  sort: Sort,
  contentHits: ReadonlyMap<string, number> = new Map(),
): Thread[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    const sorted = [...threads];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }
  // Ranked while searching (relevance, not `sort` — matches the backend dropping `sort` for the bm25
  // case). v1 dropped generated description/tags from search (weak output, no UI for it) — titles and
  // note text only. A title match always beats a content-only match; see lib/search.ts.
  return threads
    .map((t) => {
      const rank = contentHits.get(t.id);
      return { t, score: combineScore(matchScore(t.title, q), rank == null ? null : -rank) };
    })
    .filter((r): r is { t: Thread; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);
};

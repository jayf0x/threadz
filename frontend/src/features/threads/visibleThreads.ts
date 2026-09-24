import { combineScore, matchScore } from "@/lib/search";
import type { Thread } from "@/lib/types";

export const SORTS = [
  { value: "updated", label: "Recent" },
  { value: "created", label: "Newest" },
  { value: "title", label: "A–Z" },
] as const;

export type Sort = (typeof SORTS)[number]["value"];

export const isSort = (v: string): v is Sort => SORTS.some((s) => s.value === v);

// The resolved filter: "active" hides resolved threads, "all" shows everything. Not persisted —
// same as TodosPanel's closed-todo filter, resets to "active" each session.
export type ResolvedFilter = "active" | "all";

const EMPTY_IDS: ReadonlySet<string> = new Set();

// The index as the user sees it: filtered by the search box (and, unless `hidden` says otherwise,
// resolved threads), ordered, then pinned threads floated to the top. `contentHits` maps a thread
// id to its position in the API's own results (only the API can tell a note matches: the mirror
// holds no note text until a thread is opened) — lower is more relevant. `pinned`/`hidden` come
// from `lib/threadFlags.ts`'s device-local flags, not the `Thread` schema.
export const visibleThreads = (
  threads: Thread[],
  query: string,
  sort: Sort,
  contentHits: ReadonlyMap<string, number> = new Map(),
  pinned: ReadonlySet<string> = EMPTY_IDS,
  hidden: ReadonlySet<string> = EMPTY_IDS,
): Thread[] => {
  const pool = hidden.size === 0 ? threads : threads.filter((t) => !hidden.has(t.id));
  const q = query.trim().toLowerCase();
  const ordered = !q
    ? sortByField(pool, sort)
    : // Ranked while searching (relevance, not `sort` — matches the backend dropping `sort` for the bm25
      // case). v1 dropped generated description/tags from search (weak output, no UI for it) — titles and
      // note text only. A title match always beats a content-only match; see lib/search.ts.
      pool
        .map((t) => {
          const rank = contentHits.get(t.id);
          return { t, score: combineScore(matchScore(t.title, q), rank == null ? null : -rank) };
        })
        .filter((r): r is { t: Thread; score: number } => r.score != null)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.t);
  if (pinned.size === 0) return ordered;
  // Pin floats matches to the top regardless of sort or search rank, without disturbing the
  // relative order within either group (Array#filter preserves order) — a stable partition.
  return [...ordered.filter((t) => pinned.has(t.id)), ...ordered.filter((t) => !pinned.has(t.id))];
};

const sortByField = (threads: Thread[], sort: Sort): Thread[] => {
  const sorted = [...threads];
  if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted;
};

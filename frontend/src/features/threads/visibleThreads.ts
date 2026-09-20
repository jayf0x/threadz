import type { Thread } from "@/lib/types";

export const SORTS = [
  { value: "updated", label: "Recent" },
  { value: "created", label: "Newest" },
  { value: "title", label: "A–Z" },
] as const;

export type Sort = (typeof SORTS)[number]["value"];

export const isSort = (v: string): v is Sort => SORTS.some((s) => s.value === v);

// The index as the user sees it: filtered by the search box, then ordered.
export const visibleThreads = (threads: Thread[], query: string, sort: Sort): Thread[] => {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? threads.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q)),
      )
    : threads;
  const sorted = [...filtered];
  if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
  else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted;
};

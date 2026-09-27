import { useCallback, useEffect, useMemo, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { listThreads, searchThreadIds } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import { useFlaggedThreadIds } from "@/lib/threadFlags";
import type { Thread } from "@/lib/types";
import { type Sort, visibleThreads } from "./visibleThreads";

export const useThreads = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinned = useFlaggedThreadIds("pinned");

  const load = useCallback(() => listThreads().then(setThreads, (e) => setError(errorMessage(e))), []);

  // v1's `refresh` pulled from main; the phone always reads its own database now, so this just
  // re-reads it (`syncEngine.ts`'s `manualSync` is the network round-trip, wired separately —
  // see SyncSection.tsx). Kept as its own function so callers (a pull-to-refresh gesture, say)
  // still have something to call.
  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    return onChange(load);
  }, [load]);

  // Titles are matched on the device instantly; note content needs a query over every thread's
  // messages (`lib/data.ts`'s `searchThreadIds`, backed by `core.search`). `ranks` keeps that
  // query's own relevance order (id -> position) so visibleThreads can rank content-only hits by it.
  const [content, setContent] = useState<{ q: string; ranks: ReadonlyMap<string, number> }>({
    q: "",
    ranks: NO_HITS,
  });
  const contentHits = content.q === query.trim() ? content.ranks : NO_HITS;

  const visible = useMemo(
    () => visibleThreads(threads, query, sort, contentHits, pinned),
    [threads, query, sort, contentHits, pinned],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(() => {
      searchThreadIds(q).then(
        (ids) => !stale && setContent({ q, ranks: new Map(ids.map((id, i) => [id, i])) }),
        () => {},
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  return {
    threads: visible,
    allThreads: threads, // unfiltered/unsorted, for callers that need the whole set (e.g. resurfacing)
    query,
    setQuery,
    sort,
    setSort,
    syncing,
    error,
    refresh,
  };
};

const NO_HITS: ReadonlyMap<string, number> = new Map();

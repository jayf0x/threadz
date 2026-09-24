import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getThreads } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { onChange, pullThreads } from "@/lib/sync";
import { useFlaggedThreadIds } from "@/lib/threadFlags";
import type { Thread } from "@/lib/types";
import { type ResolvedFilter, type Sort, visibleThreads } from "./visibleThreads";

const NO_IDS: ReadonlySet<string> = new Set();

export const useThreads = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>("active");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinned = useFlaggedThreadIds("pinned");
  const resolved = useFlaggedThreadIds("resolved");
  const hidden = resolvedFilter === "active" ? resolved : NO_IDS;

  const load = useCallback(() => getThreads().then(setThreads, (e) => setError(errorMessage(e))), []);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await pullThreads();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    load();
    refresh();
    return onChange(load);
  }, [load, refresh]);

  // Titles, descriptions and tags are matched on the device at once; note text needs the API (main while
  // live, the device copy while local). A failed lookup just leaves the instant matches. `ranks` keeps
  // the API's own relevance order (id -> position) so visibleThreads can rank content-only hits by it.
  const [content, setContent] = useState<{ q: string; ranks: ReadonlyMap<string, number> }>({
    q: "",
    ranks: NO_HITS,
  });
  const contentHits = content.q === query.trim() ? content.ranks : NO_HITS;

  const visible = useMemo(
    () => visibleThreads(threads, query, sort, contentHits, pinned, hidden),
    [threads, query, sort, contentHits, pinned, hidden],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.listThreads(q).then(
        (rows) => !stale && setContent({ q, ranks: new Map(rows.map((r, i) => [r.id, i])) }),
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
    resolvedFilter,
    setResolvedFilter,
    syncing,
    error,
    refresh,
  };
};

const NO_HITS: ReadonlyMap<string, number> = new Map();

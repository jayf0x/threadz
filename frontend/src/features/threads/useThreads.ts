import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getThreads } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { onChange, pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";
import { type Sort, visibleThreads } from "./visibleThreads";

export const useThreads = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // live, the device copy while local). A failed lookup just leaves the instant matches.
  const [content, setContent] = useState<{ q: string; ids: ReadonlySet<string> }>({ q: "", ids: new Set() });
  const contentHits = content.q === query.trim() ? content.ids : NO_HITS;

  const visible = useMemo(() => visibleThreads(threads, query, sort, contentHits), [threads, query, sort, contentHits]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.listThreads(q).then(
        (rows) => !stale && setContent({ q, ids: new Set(rows.map((r) => r.id)) }),
        () => {},
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { threads: visible, query, setQuery, sort, setSort, syncing, error, refresh };
};

const NO_HITS: ReadonlySet<string> = new Set();

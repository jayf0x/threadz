import { useCallback, useEffect, useMemo, useState } from "react";
import { getThreads } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { onChange, pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";

export type Sort = "updated" | "created" | "title";

export const useThreads = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => getThreads().then(setThreads), []);

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

  const visible = useMemo(() => {
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
  }, [threads, query, sort]);

  return { threads: visible, query, setQuery, sort, setSort, syncing, error, refresh };
};

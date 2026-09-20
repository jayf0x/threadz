import { useCallback, useEffect, useMemo, useState } from "react";
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

  const visible = useMemo(() => visibleThreads(threads, query, sort), [threads, query, sort]);

  return { threads: visible, query, setQuery, sort, setSort, syncing, error, refresh };
};

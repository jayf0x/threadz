import { useCallback, useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { type Insight, listInsights, listPool, listThreads } from "@/lib/data";
import type { Thread } from "@/lib/types";

export type HomeData = { recent: Thread[]; poolCount: number; insights: Insight[] };

const RECENT = 5;

// One read per lens Home summarises; open todos come from `useTodosSummary`. `null` = loading.
export const useHome = () => {
  const [data, setData] = useState<HomeData | null>(null);

  const load = useCallback(() => {
    Promise.all([listThreads(), listPool(), listInsights().catch((): Insight[] => [])]).then(
      ([threads, pool, insights]) => setData({ recent: threads.slice(0, RECENT), poolCount: pool.length, insights }),
      () => setData({ recent: [], poolCount: 0, insights: [] }),
    );
  }, []);

  useEffect(() => {
    load();
    return onChange(load);
  }, [load]);

  return data;
};

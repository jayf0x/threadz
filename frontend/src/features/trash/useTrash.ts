import { useCallback, useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { type BinItem, listBin, restoreFromBin } from "@/lib/data";

// Reads the phone's own Bin directly (`lib/data.ts`'s `listBin`, backed by `core.bin`+entity kind) —
// there's no separate "trash store" to keep warm any more (v1's `threadz-local`'s own `trash` object
// store, now gone). `null` = not loaded yet, so the panel can tell "still loading" from "genuinely empty".
export const useTrash = () => {
  const [trash, setTrash] = useState<BinItem[] | null>(null);

  const load = useCallback(() => {
    listBin().then(setTrash, () => setTrash([]));
  }, []);

  useEffect(() => {
    load();
    return onChange(load); // a delete or a restore, here or on another tab, re-runs the read
  }, [load]);

  const restore = useCallback(async (id: string, kind: BinItem["kind"]) => restoreFromBin(id, kind), []);

  return { trash, restore };
};

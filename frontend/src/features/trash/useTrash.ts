import { useCallback, useEffect, useState } from "react";
import { restoreThread } from "@/lib/handoff";
import { listTrash, type TrashedThread } from "@/lib/local";
import { onChange } from "@/lib/sync";

// Reads the device's own `trash` store directly (lib/local.ts), live or local alike — same
// reasoning as useTodos.ts's exportSnapshot read: while live it's kept warm on every pull (a
// thread deleted anywhere lands here the moment the next pull notices it's gone from main; see
// lib/replica.ts's `applyRemoteDelete`). `null` = not loaded yet, so the panel can tell "still
// loading" from "genuinely empty".
export const useTrash = () => {
  const [trash, setTrash] = useState<TrashedThread[] | null>(null);

  const load = useCallback(() => {
    listTrash().then(setTrash, () => setTrash([]));
  }, []);

  useEffect(() => {
    load();
    return onChange(load); // a delete or a restore, here or on another tab, re-runs the read
  }, [load]);

  return { trash, restore: restoreThread };
};

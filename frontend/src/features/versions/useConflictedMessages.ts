import { useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { conflictedMessageIds } from "@/lib/data";

// Ids of this thread's messages whose note has two heads (core/versions.ts), refreshed on every change.
export const useConflictedMessages = (threadId: string) => {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    const load = () =>
      conflictedMessageIds(threadId).then(
        (next) => live && setIds((prev) => (prev.size === 0 && next.size === 0 ? prev : next)),
        () => {},
      );
    load();
    const off = onChange(load);
    return () => {
      live = false;
      off();
    };
  }, [threadId]);
  return ids;
};

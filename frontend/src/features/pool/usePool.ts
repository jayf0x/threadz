import { useCallback, useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { listPool, listThreads, type PoolItem, placeExistingNote } from "@/lib/data";
import type { Thread } from "@/lib/types";

// Reads the phone's own Pool directly (`lib/data.ts`'s `listPool`, backed by `core.pool`: notes with
// no live message anywhere) — same "null while loading, then the real list" shape as `useTrash`. Also
// keeps the live thread list warm, since the "send to thread" picker needs somewhere to send a note
// *to*: reusing the sidebar's own `listThreads` read rather than inventing a second query for it.
export const usePool = () => {
  const [notes, setNotes] = useState<PoolItem[] | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);

  const load = useCallback(() => {
    listPool().then(setNotes, () => setNotes([]));
    listThreads().then(setThreads, () => setThreads([]));
  }, []);

  useEffect(() => {
    load();
    return onChange(load); // sending a note (here or another tab) re-runs both reads
  }, [load]);

  // Placing the note as a live message is what removes it from `core.pool`'s result (no query call
  // needed here beyond that write — the `onChange` subscription above re-reads on its own).
  const sendToThread = useCallback((noteId: string, threadId: string) => placeExistingNote(threadId, noteId), []);

  return { notes, threads, sendToThread };
};

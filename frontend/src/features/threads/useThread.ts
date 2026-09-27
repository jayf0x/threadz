import { useCallback, useEffect, useRef, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import {
  appendNote,
  editMessage as editMessageContent,
  getThread,
  pendingMessageIds,
  renameThread,
  setTodo,
  threadMessages,
} from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import { ask as askModel } from "@/lib/syncEngine";
import type { Annotation, Message, Thread } from "@/lib/types";
import { autoTitle, noteText } from "./titles";

// Names (or renames) the thread from `content` (Settings → Naming). Fire-and-forget: a title is a
// nicety, so a failure here never touches the note that was just stored. `autoTitle` already refuses
// to touch a title that isn't still the placeholder (or exactly what it derived last time), so this
// can be called after every note — a short first note that yatefca couldn't name gets another shot
// once later notes give it more to work with, and a real title (yours or already auto-picked) is left alone.
const autoName = async (thread: Thread, content: string, previous?: string) => {
  if (!getSettings().autoName) return;
  try {
    const title = await autoTitle(thread, content, previous);
    if (!title) return;
    await renameThread(thread.id, title);
  } catch {}
};

export const useThread = (threadId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  // NOT built yet — see lib/types.ts's `Annotation` comment. Always empty until the `attached`-link
  // lens exists; kept as state (not a constant) only so the shape stays obviously swappable later.
  const [annotations] = useState<Annotation[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // this thread doesn't exist in the phone's own database
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const loads = useRef(0);
  const seenIds = useRef<Set<string>>(new Set());
  const hydrated = useRef(false);

  // Reads overlap (every change signal starts one); only the newest may write, or an older, slower
  // read could put stale messages back over fresh ones.
  const load = useCallback(async () => {
    if (!threadId) return;
    const mine = ++loads.current;
    const [rows, pending, thread] = await Promise.all([
      threadMessages(threadId),
      pendingMessageIds(threadId),
      getThread(threadId),
    ]);
    if (mine !== loads.current) return;
    setGone(!thread);
    const additions: string[] = [];
    for (const r of rows) {
      if (seenIds.current.has(r.id)) continue;
      seenIds.current.add(r.id);
      if (hydrated.current) additions.push(r.id);
    }
    hydrated.current = true;
    setMessages(rows);
    setUnsynced(pending);
    if (additions.length) {
      setJustAdded((prev) => new Set([...prev, ...additions]));
      setTimeout(() => {
        setJustAdded((prev) => {
          const next = new Set(prev);
          for (const id of additions) next.delete(id);
          return next;
        });
      }, 1000);
    }
  }, [threadId]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setGone(false);
    setJustAdded(new Set());
    seenIds.current = new Set();
    hydrated.current = false;
    load();
    const off = onChange(load);
    return () => {
      loads.current++; // a read still in flight belongs to a thread we've left
      off();
    };
  }, [load]);

  // Add a message. Resolves true only once the text is stored, so the composer never clears a draft
  // that went nowhere.
  const addMessage = useCallback(
    async (content: string, _meta: Record<string, unknown> | null = null): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      setBusy(true);
      setError(null);
      try {
        await appendNote(threadId, text, "user");
        const thread = await getThread(threadId);
        if (thread) autoName(thread, noteText([...messages, { role: "user", content: text } as Message]));
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [threadId, messages],
  );

  const editMessage = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      setBusy(true);
      setError(null);
      try {
        await editMessageContent(id, text);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [threadId],
  );

  // Flags/unflags a whole message as a todo (the ⋯ menu's "Todo" toggle) — non-textual (the `todos`
  // table), never a content edit. `done: null` clears the flag entirely.
  const setMessageTodo = useCallback(async (id: string, done: boolean | null): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await setTodo(id, done);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  // Ask Claude. commit=false → disposable scratch answer (returned, not stored). commit=true →
  // appended (by main) at ask time — v2 has no separate "commit later" step (docs/direction.md "B10"):
  // main always writes the question+answer, so a non-committed Ask just doesn't pull the result in.
  // TODO(lens step): a true scratch (never touching main at all) would need its own endpoint; out of
  // scope for this pass — every Ask reaches main today, `commit` only decides whether we pull it in.
  const ask = useCallback(
    async (prompt: string, commit: boolean): Promise<string> => {
      if (!threadId) return "";
      setBusy(true);
      setError(null);
      try {
        const answer = await askModel(threadId, prompt);
        if (commit) await load();
        return answer;
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [threadId, load],
  );

  // NOT built yet (see lib/types.ts's `Annotation` comment) — every call is a safe no-op until the
  // `attached`-link lens exists.
  const addAnnotation = useCallback(async (_messageId: string, _content: string) => false, []);
  const editAnnotation = useCallback(async (_id: string, _content: string) => false, []);
  const deleteAnnotation = useCallback(async (_id: string) => false, []);

  return {
    messages,
    annotations,
    unsynced,
    unsyncedAnnotations: EMPTY_SET,
    busy,
    error,
    gone,
    justAdded,
    addMessage,
    editMessage,
    setMessageTodo,
    addAnnotation,
    editAnnotation,
    deleteAnnotation,
    ask,
    refresh: load,
  };
};

const EMPTY_SET: Set<string> = new Set();

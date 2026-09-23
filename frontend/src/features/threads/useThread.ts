import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getThreadAnnotations, getThreadMessages } from "@/lib/db";
import { ApiError, errorMessage } from "@/lib/errors";
import { unsyncedAnnotationIds, unsyncedMessageIds } from "@/lib/local";
import { getSettings } from "@/lib/settings";
import { onChange, pullThread, pullThreads } from "@/lib/sync";
import type { Annotation, Message, Thread } from "@/lib/types";
import { autoTitle, noteText } from "./titles";

const uuid = () => crypto.randomUUID();

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
    await api.renameThread(thread.id, title);
    await pullThreads();
  } catch {}
};

export const useThread = (threadId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const [unsyncedAnnotations, setUnsyncedAnnotations] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // the active store says this thread does not exist
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const loads = useRef(0);
  // Every `messages` update — initial history and every later change alike — flows through this
  // same `load()`, so it's the one place that can tell "was already here" from "just showed up".
  // The very first resolution (whatever it finds, even nothing) is the history load and seeds
  // `seenIds` without flagging anything; only ids that appear afterwards go into `justAdded`, so a
  // long thread's initial render never animates and a genuinely new/incoming message does.
  const seenIds = useRef<Set<string>>(new Set());
  const hydrated = useRef(false);

  // Reads overlap (every change signal starts one); only the newest may write, or an older,
  // slower read could put stale messages back over fresh ones.
  const load = useCallback(async () => {
    if (!threadId) return;
    const mine = ++loads.current;
    // Notes (and annotations) only the device has (written while detached) are marked until they sync.
    const [rows, pending, annos, pendingAnnos] = await Promise.all([
      getThreadMessages(threadId),
      unsyncedMessageIds(threadId),
      getThreadAnnotations(threadId),
      unsyncedAnnotationIds(threadId),
    ]);
    if (mine !== loads.current) return;
    const additions: string[] = [];
    for (const r of rows) {
      if (seenIds.current.has(r.id)) continue;
      seenIds.current.add(r.id);
      if (hydrated.current) additions.push(r.id);
    }
    hydrated.current = true;
    setMessages(rows);
    setUnsynced(pending);
    setAnnotations(annos);
    setUnsyncedAnnotations(pendingAnnos);
    // Self-clearing, not permanent: `isNew` only needs to be true long enough for the entrance
    // animation to play once. Left set forever, it'd replay on every future remount of the same
    // row — which a virtualized list does constantly as rows scroll in and out — and it'd retain
    // every message id ever seen in a long-lived thread for nothing.
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

  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      await pullThread(threadId);
      setGone(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError(errorMessage(e));
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
    refresh();
    const off = onChange(load);
    return () => {
      loads.current++; // a read still in flight belongs to a thread we've left
      off();
    };
  }, [load, refresh]);

  // Add a message. `api` writes to main, or to the device copy when detached (switching
  // by itself if main just vanished). Resolves true only once the text is stored, so the
  // composer never clears a draft that went nowhere.
  const addMessage = useCallback(
    async (content: string, meta: Record<string, unknown> | null = null): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      setBusy(true);
      setError(null);
      try {
        await api.appendMessage(threadId, { id: uuid(), role: "user", content: text, meta });
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
      // refreshing the view can fail; the write already succeeded
      const view = await pullThread(threadId).catch(() => null);
      if (view) autoName(view.thread, noteText(view.messages));
      return true;
    },
    [threadId],
  );

  // Edit a sent message. Same contract as addMessage: true only once the new text is stored.
  const editMessage = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      setBusy(true);
      setError(null);
      try {
        await api.editMessage(threadId, id, text);
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
      const view = await pullThread(threadId).catch(() => null);
      const first = view?.messages[0];
      if (view && first?.id === id) autoName(view.thread, first.content, first.edits?.at(-1)?.content);
      return true;
    },
    [threadId],
  );

  // Ask Claude. commit=false → disposable scratch answer (returned, not stored).
  // commit=true → appended at commit time.
  const ask = useCallback(
    async (prompt: string, commit: boolean): Promise<string> => {
      if (!threadId) return "";
      setBusy(true);
      setError(null);
      try {
        const { answer } = await api.ask(threadId, {
          prompt,
          commit,
          userMessageId: uuid(),
          assistantMessageId: uuid(),
        });
        if (commit) await pullThread(threadId);
        return answer;
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [threadId],
  );

  // Edit an existing annotation's content, keeping history (same contract as editMessage).
  const editAnnotation = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      setBusy(true);
      setError(null);
      try {
        await api.editAnnotation(threadId, id, text);
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
      await pullThread(threadId).catch(() => {});
      return true;
    },
    [threadId],
  );

  // Add a note to a message — or, when the backend's one-per-message constraint would refuse a
  // second row (this device already knows about one for this message), fold the text in as an edit
  // onto it instead. Belt-and-suspenders: keeps normal use from ever hitting the DB constraint path,
  // which a stale UI or two offline devices could still reach (see db.ts's appendAnnotation).
  const addAnnotation = useCallback(
    async (messageId: string, content: string): Promise<boolean> => {
      const text = content.trim();
      if (!threadId || !text) return false;
      const existing = annotations.find((a) => a.messageId === messageId);
      if (existing) return editAnnotation(existing.id, text);
      setBusy(true);
      setError(null);
      try {
        await api.appendAnnotation(threadId, messageId, { id: uuid(), content: text });
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
      await pullThread(threadId).catch(() => {}); // the write already succeeded even if the refresh fails
      return true;
    },
    [threadId, annotations, editAnnotation],
  );

  const deleteAnnotation = useCallback(
    async (id: string): Promise<boolean> => {
      if (!threadId) return false;
      setBusy(true);
      setError(null);
      try {
        await api.deleteAnnotation(threadId, id);
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
      await pullThread(threadId).catch(() => {});
      return true;
    },
    [threadId],
  );

  return {
    messages,
    annotations,
    unsynced,
    unsyncedAnnotations,
    busy,
    error,
    gone,
    justAdded,
    addMessage,
    editMessage,
    addAnnotation,
    editAnnotation,
    deleteAnnotation,
    ask,
    refresh,
  };
};

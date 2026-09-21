import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getThreadMessages } from "@/lib/db";
import { ApiError, errorMessage } from "@/lib/errors";
import { unsyncedMessageIds } from "@/lib/local";
import { getSettings } from "@/lib/settings";
import { onChange, pullThread, pullThreads } from "@/lib/sync";
import type { Message, Thread } from "@/lib/types";
import { autoTitle } from "./titles";

const uuid = () => crypto.randomUUID();

// The first note names its thread (Settings → Naming). Fire-and-forget: a title is a nicety, so a failure here
// never touches the note that was just stored.
const autoName = async (thread: Thread, first: Message, previous?: string) => {
  if (!getSettings().autoName) return;
  try {
    const title = await autoTitle(thread, first.content, previous);
    if (!title) return;
    await api.renameThread(thread.id, title);
    await pullThreads();
  } catch {}
};

export const useThread = (threadId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // the active store says this thread does not exist
  const loads = useRef(0);

  // Reads overlap (every change signal starts one); only the newest may write, or an older,
  // slower read could put stale messages back over fresh ones.
  const load = useCallback(async () => {
    if (!threadId) return;
    const mine = ++loads.current;
    // Notes only the device has (written while detached) are marked until they sync.
    const [rows, pending] = await Promise.all([getThreadMessages(threadId), unsyncedMessageIds(threadId)]);
    if (mine !== loads.current) return;
    setMessages(rows);
    setUnsynced(pending);
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
      if (view?.messages.length === 1) autoName(view.thread, view.messages[0]!);
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
      if (view && first?.id === id) autoName(view.thread, first, first.edits?.at(-1)?.content);
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

  return { messages, unsynced, busy, error, gone, addMessage, editMessage, ask, refresh };
};

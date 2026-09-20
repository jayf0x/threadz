import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getThreadMessages } from "@/lib/db";
import { unsyncedMessageIds } from "@/lib/local";
import { onChange, pullThread } from "@/lib/sync";
import type { Message } from "@/lib/types";

const uuid = () => crypto.randomUUID();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useThread = (threadId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!threadId) return;
    setMessages(await getThreadMessages(threadId));
    // Notes only the device has (written while detached) are marked until they sync.
    setUnsynced(await unsyncedMessageIds(threadId));
  }, [threadId]);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      await pullThread(threadId);
    } catch (e) {
      setError(msg(e));
    }
  }, [threadId]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    load();
    refresh();
    return onChange(load);
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
        setError(msg(e));
        return false;
      } finally {
        setBusy(false);
      }
      await pullThread(threadId).catch(() => {}); // refreshing the view can fail; the write already succeeded
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
        setError(msg(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [threadId],
  );

  return { messages, unsynced, busy, error, addMessage, ask, refresh };
};

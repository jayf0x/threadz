import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getThreadMessages, getThreadOutbox } from "@/lib/db";
import { flushOutbox, onChange, pullThread, queueMessage } from "@/lib/sync";
import type { Message, OutboxItem } from "@/lib/types";

const uuid = () => crypto.randomUUID();

export const useThread = (threadId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!threadId) return;
    setMessages(await getThreadMessages(threadId));
    setOutbox(await getThreadOutbox(threadId));
  }, [threadId]);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      await pullThread(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId]);

  useEffect(() => {
    setMessages([]);
    setOutbox([]);
    setError(null);
    load();
    refresh();
    return onChange(load);
  }, [load, refresh]);

  // Add a message. Online → send now (idempotent). Offline → queue it.
  const addMessage = useCallback(
    async (content: string, meta: Record<string, unknown> | null = null) => {
      if (!threadId || !content.trim()) return;
      const id = uuid();
      if (navigator.onLine) {
        setBusy(true);
        try {
          await api.appendMessage(threadId, { id, role: "user", content: content.trim(), meta });
          await pullThread(threadId);
        } catch {
          await queueMessage({ id, threadId, content: content.trim(), meta });
        } finally {
          setBusy(false);
        }
      } else {
        await queueMessage({ id, threadId, content: content.trim(), meta });
      }
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
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [threadId],
  );

  const send = useCallback(async () => {
    setBusy(true);
    try {
      return await flushOutbox();
    } finally {
      setBusy(false);
    }
  }, []);

  return { messages, outbox, busy, error, addMessage, ask, send, refresh };
};

import { api } from "./api";
import { addToOutbox, getOutbox, putThread, putThreads, removeFromOutbox, replaceThreadMessages } from "./db";
import type { OutboxItem } from "./types";

// Cross-tab + in-app change signal. Any device/tab that mutates state broadcasts;
// listeners re-pull from the mirror.
const channel = "BroadcastChannel" in self ? new BroadcastChannel("threadz") : null;
const local = new EventTarget();

export const onChange = (fn: () => void) => {
  const h = () => fn();
  local.addEventListener("change", h);
  channel?.addEventListener("message", h);
  return () => {
    local.removeEventListener("change", h);
    channel?.removeEventListener("message", h);
  };
};

const emitChange = () => {
  local.dispatchEvent(new Event("change"));
  channel?.postMessage("change");
};

export const pullThreads = async () => {
  const threads = await api.listThreads();
  await putThreads(threads);
  emitChange();
  return threads;
};

export const pullThread = async (id: string) => {
  const { thread, messages } = await api.getThread(id);
  await putThread(thread);
  await replaceThreadMessages(id, messages);
  emitChange();
  return { thread, messages };
};

// Queue an unsent draft. Never auto-sends — the user flushes explicitly.
export const queueMessage = async (item: Omit<OutboxItem, "createdAt">) => {
  await addToOutbox({ ...item, createdAt: Date.now() });
  emitChange();
};

export const isOnline = () => navigator.onLine;

// Explicit "send pending items". Pushes in creation order; stops at the first
// failure and leaves the rest queued. Idempotency keys make a retry safe.
export const flushOutbox = async (): Promise<{ sent: number; failed: number }> => {
  const items = (await getOutbox()).sort((a, b) => a.createdAt - b.createdAt);
  let sent = 0;
  const touched = new Set<string>();
  for (const item of items) {
    try {
      await api.appendMessage(item.threadId, { id: item.id, role: "user", content: item.content, meta: item.meta });
      await removeFromOutbox(item.id);
      touched.add(item.threadId);
      sent++;
    } catch (err) {
      console.warn("[threadz] flush stopped:", err);
      emitChange();
      for (const id of touched) await pullThread(id).catch(() => {});
      return { sent, failed: items.length - sent };
    }
  }
  for (const id of touched) await pullThread(id).catch(() => {});
  await pullThreads().catch(() => {});
  emitChange();
  return { sent, failed: 0 };
};

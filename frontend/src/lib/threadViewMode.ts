import { useSyncExternalStore } from "react";

// Device-local per-thread view preference: line mode renders a thread's messages as one continuous
// document instead of chat bubbles (docs/direction.md "Round 6": "the choice is remembered per
// device (not synced), since it's a view preference, not content"). Same shape as
// `lib/threadOrder.ts`'s reversed-order flag — a thread that's never been switched has no entry
// (default: chat mode), so this never grows unbounded with every thread ever opened.
const KEY = "threadz.lineMode";

const read = (): Record<string, true> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, true> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === true) out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
};

let current = read();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const isThreadLineMode = (threadId: string) => current[threadId] === true;

export const setThreadLineMode = (threadId: string, lineMode: boolean) => {
  if (isThreadLineMode(threadId) === lineMode) return;
  const next = { ...current };
  if (lineMode) next[threadId] = true;
  else delete next[threadId];
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  emit();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useThreadLineMode = (threadId: string) =>
  useSyncExternalStore(subscribe, () => isThreadLineMode(threadId));

// Another tab switched the same thread's mode.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  });
}

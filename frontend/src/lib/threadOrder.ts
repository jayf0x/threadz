import { useSyncExternalStore } from "react";

// Device-local per-thread view preference: reversed = newest message at top instead of the
// default oldest-at-top/newest-at-bottom. Not synced — per-device, same shape as lib/settings.ts,
// just keyed by thread id instead of one flat object. A thread that's never been flipped has no
// entry (default: not reversed), so this never grows unbounded with every thread ever opened.
const KEY = "threadz.reverseOrder";

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

export const isThreadReversed = (threadId: string) => current[threadId] === true;

export const setThreadReversed = (threadId: string, reversed: boolean) => {
  if (isThreadReversed(threadId) === reversed) return;
  const next = { ...current };
  if (reversed) next[threadId] = true;
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

export const useThreadReversed = (threadId: string) =>
  useSyncExternalStore(subscribe, () => isThreadReversed(threadId));

// Another tab flipped the same thread's order. (No `window` under `bun test` — same guard `read()`'s
// try/catch gives the localStorage calls above, just explicit here since there's no call to catch.)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  });
}

// Pure so it's trivial to test on its own (see threadOrder.test.ts) and so every consumer that
// cares about rendering order — the virtualizer's count/key, the render loop's index lookup, the
// jump-to-message findIndex — reads the same derived array instead of each reimplementing the flip.
export const orderMessages = <T>(messages: T[], reversed: boolean): T[] =>
  reversed ? [...messages].reverse() : messages;

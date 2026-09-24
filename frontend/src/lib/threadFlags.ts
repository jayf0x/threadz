import { useSyncExternalStore } from "react";

// Device-local per-thread boolean flags, keyed by flag name (e.g. "pinned", "resolved") plus
// thread id — same shape as lib/threadOrder.ts, generalized to hold several independent flags
// in one store instead of one store per flag. Not synced — per-device only. A thread that's
// never had a flag set has no entry (default: false), so this never grows unbounded with every
// thread ever opened.
const KEY = "threadz.threadFlags";

type FlagState = Record<string, Record<string, true>>;

const read = (): FlagState => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    const out: FlagState = {};
    for (const [flag, threads] of Object.entries(raw as Record<string, unknown>)) {
      if (!threads || typeof threads !== "object") continue;
      const ids: Record<string, true> = {};
      for (const [id, v] of Object.entries(threads as Record<string, unknown>)) {
        if (v === true) ids[id] = true;
      }
      if (Object.keys(ids).length > 0) out[flag] = ids;
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

export const isThreadFlagSet = (flag: string, threadId: string) => current[flag]?.[threadId] === true;

export const setThreadFlag = (flag: string, threadId: string, value: boolean) => {
  if (isThreadFlagSet(flag, threadId) === value) return;
  const next: FlagState = { ...current };
  const threads = { ...next[flag] };
  if (value) threads[threadId] = true;
  else delete threads[threadId];
  if (Object.keys(threads).length > 0) next[flag] = threads;
  else delete next[flag];
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

export const useThreadFlag = (flag: string, threadId: string) =>
  useSyncExternalStore(subscribe, () => isThreadFlagSet(flag, threadId));

// Another tab set the same flag. (No `window` under `bun test` — same guard `read()`'s
// try/catch gives the localStorage calls above, just explicit here since there's no call to catch.)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  });
}

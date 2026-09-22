import { useSyncExternalStore } from "react";

// Device-local preferences. (The voice model keeps its own store, lib/voice/engine.ts.)
// backendUrl: null = auto-detect (see lib/config.ts); a string overrides it, for a phone that
// installed the PWA from `localhost` and can otherwise never reach the Mac again.
export type Settings = { autoName: boolean; backendUrl: string | null };

const KEY = "threadz.settings";
const DEFAULTS: Settings = { autoName: true, backendUrl: null };

const read = (): Settings => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const stored = raw && typeof raw === "object" ? raw : {};
    return {
      autoName: "autoName" in stored && typeof stored.autoName === "boolean" ? stored.autoName : DEFAULTS.autoName,
      backendUrl:
        "backendUrl" in stored && (typeof stored.backendUrl === "string" || stored.backendUrl === null)
          ? stored.backendUrl
          : DEFAULTS.backendUrl,
    };
  } catch {
    return DEFAULTS;
  }
};

let current = read();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const getSettings = () => current;

export const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  emit();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings);

// Another tab changed a setting.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  current = read();
  emit();
});

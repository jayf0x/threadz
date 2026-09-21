import { useSyncExternalStore } from "react";

// Device-local preferences. (The voice model keeps its own store, lib/voice/engine.ts.)
export type Settings = { autoName: boolean };

const KEY = "threadz.settings";
const DEFAULTS: Settings = { autoName: true };

const read = (): Settings => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const stored = raw && typeof raw === "object" ? raw : {};
    return {
      autoName: "autoName" in stored && typeof stored.autoName === "boolean" ? stored.autoName : DEFAULTS.autoName,
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

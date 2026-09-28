import { useSyncExternalStore } from "react";

// Saved Map filters. Device-only, like lib/settings.ts: never synced, never in a backup. A preset is a name
// plus the filter's `/map?` query string, so it needs no schema of its own and stays valid as filters grow.
export type MapPreset = { id: string; name: string; search: string };

const KEY = "threadz.mapPresets";

const read = (): MapPreset[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((p: unknown) =>
      p &&
      typeof p === "object" &&
      "id" in p &&
      typeof p.id === "string" &&
      "name" in p &&
      typeof p.name === "string" &&
      "search" in p &&
      typeof p.search === "string"
        ? [{ id: p.id, name: p.name, search: p.search }]
        : [],
    );
  } catch {
    return [];
  }
};

let current = read();
const listeners = new Set<() => void>();

const write = (next: MapPreset[]) => {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const l of listeners) l();
};

export const saveMapPreset = (name: string, search: string): MapPreset => {
  const preset = { id: crypto.randomUUID(), name, search };
  write([...current, preset]);
  return preset;
};

export const deleteMapPreset = (id: string) => write(current.filter((p) => p.id !== id));

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useMapPresets = () => useSyncExternalStore(subscribe, () => current);

window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  current = read();
  for (const l of listeners) l();
});

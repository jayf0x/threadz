import type { MapFilter } from "@threadz/core";

export type PresetOption = { id: string; name: string; filter: MapFilter };

export const DAY = 86_400_000;

// Built-in filter presets. Time ranges are relative to `now`, so they are built when the map opens.
export const builtinPresets = (now: number): PresetOption[] => [
  { id: "builtin:open", name: "Open todos", filter: { todo: "open" } },
  { id: "builtin:done", name: "Done todos", filter: { todo: "done" } },
  { id: "builtin:stale", name: "Stale pins", filter: { pinned: "stale" } },
  { id: "builtin:7d", name: "Last 7 days", filter: { from: now - 7 * DAY } },
  { id: "builtin:30d", name: "Last 30 days", filter: { from: now - 30 * DAY } },
];

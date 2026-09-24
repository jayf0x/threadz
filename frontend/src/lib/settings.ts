import { useSyncExternalStore } from "react";

// Device-local preferences. (The voice model keeps its own store, lib/voice/engine.ts.)
// backendUrl: null = auto-detect (see lib/config.ts); a string overrides it, for a phone that
// installed the PWA from `localhost` and can otherwise never reach the Mac again.
// background: the wallpaper (features/appearance/BackgroundLayer.tsx) — same for every thread, a
// setting like any other here, so it's already identical in Local and Live without either mode
// knowing it exists. The image bytes themselves live separately, in lib/backgroundImage.ts's own
// IndexedDB (too big for localStorage) — this only ever holds the small pointer/config around them.
// "gradient" is a real type value (the out-of-the-box default, a subtle ambient wash — see
// features/appearance/gradients.ts) but not a user-facing choice: Settings' Background section only
// offers None/Image. There's exactly one gradient now, so there's no `gradientId` to pick among.
export type BackgroundType = "none" | "image" | "gradient";
export type BackgroundSettings = { type: BackgroundType; opacity: number };
export type Settings = { autoName: boolean; backendUrl: string | null; background: BackgroundSettings };

const KEY = "threadz.settings";
const DEFAULT_BACKGROUND: BackgroundSettings = { type: "gradient", opacity: 10 };
const DEFAULTS: Settings = { autoName: true, backendUrl: null, background: DEFAULT_BACKGROUND };

const readBackground = (stored: object): BackgroundSettings => ({
  type:
    "type" in stored && (stored.type === "none" || stored.type === "image" || stored.type === "gradient")
      ? stored.type
      : DEFAULT_BACKGROUND.type,
  opacity:
    "opacity" in stored && typeof stored.opacity === "number" && stored.opacity >= 0 && stored.opacity <= 100
      ? stored.opacity
      : DEFAULT_BACKGROUND.opacity,
});

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
      background:
        "background" in stored && stored.background && typeof stored.background === "object"
          ? readBackground(stored.background)
          : DEFAULT_BACKGROUND,
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

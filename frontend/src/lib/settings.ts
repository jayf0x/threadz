import { useSyncExternalStore } from "react";
import { isTouch } from "./dom";

// Device-local preferences. (The voice model keeps its own store, lib/voice/engine.ts.)
// backendUrl: null = auto-detect (see lib/config.ts); a string overrides it, for a phone that
// installed the PWA from `localhost` and can otherwise never reach the Mac again.
// background: the wallpaper (features/appearance/BackgroundLayer.tsx) — same for every thread, a
// setting like any other here, so it's already identical in Local and Live without either mode
// knowing it exists. The image bytes themselves live separately, in lib/backgroundImage.ts's own
// IndexedDB (too big for localStorage) — this only ever holds the small pointer/config around them.
// "gradient" is the out-of-the-box default (a subtle ambient wash — see features/appearance/
// gradients.ts); "image" is the user's own wallpaper, and removing it goes back to the wash. There's no
// "none" any more (a stored one reads as the default). `opacity` only means something for an image: it
// is how much of the wallpaper shows through the panes (see `paneAlpha`).
export type BackgroundType = "image" | "gradient";
export type BackgroundSettings = { type: BackgroundType; opacity: number };
export type Settings = {
  autoName: boolean;
  backendUrl: string | null;
  background: BackgroundSettings;
  lockZoom: boolean;
};

const KEY = "threadz.settings";
export const DEFAULT_BACKGROUND_OPACITY = 80;
const DEFAULT_BACKGROUND: BackgroundSettings = { type: "gradient", opacity: DEFAULT_BACKGROUND_OPACITY };
// lockZoom: no pinch/double-tap zoom (the viewport meta + `touch-action`, see applyLockZoom). Costs
// accessibility, so it defaults on only where zoom glitches actually happen: touch-first devices.
const DEFAULTS: Settings = {
  autoName: true,
  backendUrl: null,
  background: DEFAULT_BACKGROUND,
  lockZoom: isTouch(),
};

const readBackground = (stored: object): BackgroundSettings => ({
  type: "type" in stored && stored.type === "image" ? "image" : "gradient",
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
      lockZoom: "lockZoom" in stored && typeof stored.lockZoom === "boolean" ? stored.lockZoom : DEFAULTS.lockZoom,
    };
  } catch {
    return DEFAULTS;
  }
};

const BASE_VIEWPORT = "width=device-width, initial-scale=1, viewport-fit=cover";

// iOS Safari ignores `user-scalable=no` in a browser tab but honours it in the installed PWA;
// `touch-action: pan-x pan-y` (data-lock-zoom, styles.css) covers the rest. Not `pan-y` alone: that
// would also kill horizontal scrolling of wide content.
const applyLockZoom = (lock: boolean) => {
  if (typeof document === "undefined") return; // bun test has no DOM
  document.documentElement.toggleAttribute("data-lock-zoom", lock);
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", lock ? `${BASE_VIEWPORT}, maximum-scale=1, user-scalable=no` : BASE_VIEWPORT);
};

// The panes are painted over the wallpaper at this opacity (styles.css's `surface-*`). It used to be a
// flat 92% — so even a 100% wallpaper showed through at 8% and looked "hidden". With an image it now
// falls as the slider rises (cubic: the low end stays readable, 80% is clearly visible, 100% strong).
const paneAlpha = ({ type, opacity }: BackgroundSettings) =>
  type === "image" ? Math.round(92 - 55 * (opacity / 100) ** 3) : 92;

const applyBackground = (bg: BackgroundSettings) => {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--pane-alpha", `${paneAlpha(bg)}%`);
};

let current = read();
applyLockZoom(current.lockZoom);
applyBackground(current.background);
const listeners = new Set<() => void>();
const emit = () => {
  applyLockZoom(current.lockZoom);
  applyBackground(current.background);
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

import { useSyncExternalStore } from "react";
import { ping } from "./api";
import { HAS_BACKEND } from "./config";
import { countUnsynced } from "./local";
import { detach, getMode, onMode, replicaReady, takeDetached } from "./mode";
import { pullMain } from "./replica";
import { onChange } from "./sync";
import type { Mode, Unsynced } from "./types";

// One shared view of "where am I, can I reach main, what's unsynced". Nothing
// here changes the mode: connectivity only ever raises a hint (`nudge`) that
// the user acts on.
export type Status = {
  mode: Mode;
  checked: boolean; // has the first probe answered yet
  reachable: boolean;
  unsynced: Unsynced;
  panel: boolean; // connection dialog open
  nudge: boolean; // "main is back" banner
  detached: boolean; // "main went away, you're on the device copy" banner
};

const NONE: Unsynced = { threads: 0, messages: 0, annotations: 0, deletions: 0 };
const PROBE_MS = 15000; // polled only while the page is visible

let state: Status = {
  mode: getMode(),
  checked: !HAS_BACKEND,
  reachable: false,
  unsynced: NONE,
  panel: false,
  nudge: false,
  detached: false,
};
const listeners = new Set<() => void>();

const set = (patch: Partial<Status>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const total = (u: Unsynced) => u.threads + u.messages + u.annotations + u.deletions;

export const openPanel = () => set({ panel: true, nudge: false });
export const closePanel = () => set({ panel: false });
export const dismissNudge = () => set({ nudge: false, detached: false });

export const refreshUnsynced = async () => {
  const u = await countUnsynced().catch(() => NONE);
  if (JSON.stringify(u) !== JSON.stringify(state.unsynced)) set({ unsynced: u });
};

// A flip needs two agreeing probes, so one dropped packet can't blink the UI. The very first probe just
// sets the initial reading (there is nothing to flip from) — but it never detaches by itself: leaving
// live mode needs `DETACH_AFTER` failed probes in a row, counted separately from the displayed state.
const DETACH_AFTER = 2;
let streak = 0;
let misses = 0;
export const probe = async () => {
  if (!HAS_BACKEND) return;
  const ok = await ping();
  misses = ok ? 0 : misses + 1;
  if (!state.checked) {
    set({ checked: true, reachable: ok, nudge: ok && state.mode === "local" });
  } else if (ok === state.reachable) {
    streak = 0;
  } else if (++streak >= 2) {
    streak = 0;
    set({ reachable: ok, nudge: ok && state.mode === "local" });
  }
  // Cut off from main while live, with a full copy on the device: carry on locally.
  if (misses >= DETACH_AFTER && state.mode === "live" && replicaReady()) detach();
  // Reachable while live: keep the device copy current so the next cut-off is seamless.
  if (ok && state.mode === "live") pullMain().catch(() => {});
};

let timer: ReturnType<typeof setInterval> | undefined;
let stops: (() => void)[] = [];

const start = () => {
  const visible = () => document.visibilityState === "visible";
  const wake = () => visible() && probe();
  // No timer at all while hidden: a background tab/PWA shouldn't wake the radio.
  const onVisibility = () => {
    clearInterval(timer);
    if (!visible()) return;
    probe();
    timer = setInterval(probe, PROBE_MS);
  };
  addEventListener("online", probe);
  addEventListener("focus", wake);
  document.addEventListener("visibilitychange", onVisibility);
  stops = [
    () => removeEventListener("online", probe),
    () => removeEventListener("focus", wake),
    () => document.removeEventListener("visibilitychange", onVisibility),
    onChange(refreshUnsynced),
    onMode(() => {
      set({ mode: getMode(), nudge: false, detached: takeDetached() });
      refreshUnsynced();
    }),
  ];
  onVisibility();
  refreshUnsynced();
};

const stop = () => {
  clearInterval(timer);
  for (const s of stops) s();
  stops = [];
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) stop();
  };
};

export const useStatus = () => useSyncExternalStore(subscribe, () => state);

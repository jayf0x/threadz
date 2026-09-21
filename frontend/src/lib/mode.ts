import { LOCAL_BUILD } from "./config";
import type { Mode } from "./types";

// Live vs local is the user's explicit choice, persisted, and never flipped by
// connectivity. Other tabs follow via the `storage` event so two tabs can't
// write to different stores.
const KEY = "threadz.mode";
const listeners = new Set<() => void>();

const read = (): Mode => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "live" || v === "local") return v;
  } catch {}
  return LOCAL_BUILD ? "local" : "live";
};

let current = read();

export const getMode = () => current;

// The device can only work detached once it holds a full copy of main (lib/replica.ts
// sets this after its first successful pull). Before that, going local would show nothing.
const READY = "threadz.replica";
export const replicaReady = () => {
  try {
    return !!localStorage.getItem(READY);
  } catch {
    return false;
  }
};
export const markReplicaReady = () => {
  try {
    localStorage.setItem(READY, String(Date.now()));
  } catch {}
};

// Main became unreachable: switch to the device copy on our own, once, and say so.
// Coming back is never automatic — that needs a click (lib/handoff.ts).
let auto = false;
export const detach = () => {
  if (current === "local") return; // already there: nothing went away, and a stale flag would lie after the next goLive
  auto = true;
  setMode("local");
};
export const takeDetached = () => {
  const was = auto;
  auto = false;
  return was;
};

export const setMode = (mode: Mode) => {
  if (mode === current) return;
  current = mode;
  if (mode === "live") auto = false; // an unclaimed "main went away" must not outlive going live
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  for (const l of listeners) l();
};

export const onMode = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  const next = read();
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
});

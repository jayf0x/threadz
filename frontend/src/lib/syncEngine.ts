import { applyChanges, type Changes, countChanges, pendingChanges } from "@threadz/core";
import { useSyncExternalStore } from "react";
import { emitChange, onChange } from "./changeSignal";
import { getBackendUrl } from "./config";
import { getPhoneDb } from "./data";
import { errorMessage } from "./errors";

// v2 sync (docs/direction.md "Sync" + "B7" keep-live + "B10" Ask): the phone always reads/writes
// its own database (lib/data.ts); this is the only thing that talks to main. There is no "live"/
// "local" mode any more — `AGENTS.md`'s old mode rules (auto-detach, `remoteApi`/`localApi`) are
// gone. Replaces v1's lib/handoff.ts + lib/replica.ts + lib/mode.ts + lib/status.ts.

const REV_KEY = "threadz.rev";
const getCursor = (): number => Number(localStorage.getItem(REV_KEY)) || 0;
const setCursor = (rev: number) => {
  try {
    localStorage.setItem(REV_KEY, String(rev));
  } catch {}
};

const driver = async () => (await getPhoneDb()).driver;

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${getBackendUrl()}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    throw new Error(typeof error === "string" && error ? error : `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

// Push: this device's pending rows (no `rev` yet). Main returns them stamped, so applying the
// response is enough to clear them locally — no separate round-trip needed just for that.
const push = async (): Promise<void> => {
  const d = await driver();
  const body = await pendingChanges(d);
  const { changes, cursor } = await req<{ changes: Partial<Changes>; cursor: number }>("/api/push", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await applyChanges(d, changes);
  setCursor(cursor);
};

// Pull: rows main has that this device's cursor hasn't seen.
const pull = async (): Promise<void> => {
  const d = await driver();
  const since = getCursor();
  const { changes, cursor } = await req<{ changes: Partial<Changes>; cursor: number }>(`/api/changes?since=${since}`);
  await applyChanges(d, changes);
  setCursor(cursor);
};

// One push-then-pull cycle — "sync now", or the button behind keep-live's timer alike.
export const syncNow = async (): Promise<void> => {
  await push();
  await pull();
  emitChange();
};

// --- status ------------------------------------------------------------------------------------
// direction.md "B9": synced / N pending / keep-live on / main unreachable.

export type SyncStatus = {
  pending: number;
  syncing: boolean;
  keepLive: boolean;
  unreachable: boolean; // last sync attempt failed — Ask is disabled while this is true (B10)
  lastError: string | null;
  panel: boolean; // connection dialog open
};

let state: SyncStatus = {
  pending: 0,
  syncing: false,
  keepLive: false,
  unreachable: false,
  lastError: null,
  panel: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const openPanel = () => set({ panel: true });
export const closePanel = () => set({ panel: false });

export const refreshPending = async (): Promise<void> => {
  try {
    const d = await driver();
    set({ pending: countChanges(await pendingChanges(d)) });
  } catch {
    // best effort — a failed count just leaves the last known number on screen
  }
};

// Manual "Sync now" (the button; also what keep-live's timer calls).
export const manualSync = async (): Promise<void> => {
  set({ syncing: true, lastError: null });
  try {
    await syncNow();
    failures = 0;
    set({ unreachable: false });
  } catch (e) {
    set({ lastError: errorMessage(e) });
    throw e;
  } finally {
    set({ syncing: false });
    await refreshPending();
  }
};

const KEEP_LIVE_MS = 15_000;
const MAX_FAILURES = 5; // B7: keep-live turns itself off after 5 consecutive failed polls
let failures = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const tick = async () => {
  if (document.visibilityState !== "visible") return; // B7: pauses while hidden
  set({ syncing: true });
  try {
    await syncNow();
    failures = 0;
    set({ unreachable: false, lastError: null });
  } catch (e) {
    failures++;
    set({ lastError: errorMessage(e) });
    if (failures >= MAX_FAILURES) {
      stopKeepLive();
      set({ unreachable: true });
    }
  } finally {
    set({ syncing: false });
    await refreshPending();
  }
};

const startKeepLive = () => {
  failures = 0;
  set({ keepLive: true });
  tick();
  timer = setInterval(tick, KEEP_LIVE_MS);
};

const stopKeepLive = () => {
  clearInterval(timer);
  timer = undefined;
  set({ keepLive: false });
};

export const setKeepLive = (on: boolean) => {
  if (on === state.keepLive) return;
  if (on) startKeepLive();
  else stopKeepLive();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  if (listeners.size === 1) {
    refreshPending();
    const off = onChange(refreshPending);
    const onVisible = () => document.visibilityState === "visible" && state.keepLive && tick();
    document.addEventListener("visibilitychange", onVisible);
    stopListening = () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) stopListening?.();
  };
};
let stopListening: (() => void) | undefined;

export const useSyncStatus = () => useSyncExternalStore(subscribe, () => state);

// --- Ask (docs/direction.md "B10") --------------------------------------------------------------
// push -> POST /api/ask -> main writes the question+answer as notes -> apply the returned changes.
// Unavailable while `unreachable` — the caller (Composer/ThreadView) just doesn't offer the control;
// there is no queued-Ask state.
export const ask = async (threadId: string, question: string): Promise<string> => {
  const d = await driver();
  await push();
  const { answer, changes, cursor } = await req<{ answer: string; changes: Partial<Changes>; cursor: number }>(
    "/api/ask",
    { method: "POST", body: JSON.stringify({ threadId, question }) },
  );
  await applyChanges(d, changes);
  setCursor(cursor);
  emitChange();
  return answer;
};

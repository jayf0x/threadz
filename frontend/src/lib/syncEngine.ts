import { applyChanges, type Changes, countChanges, pendingChanges, TABLE_NAMES } from "@threadz/core";
import { useSyncExternalStore } from "react";
import { emitChange, onChange } from "./changeSignal";
import { getBackendUrl } from "./config";
import { getPhoneDb, pruneOldVersions } from "./data";
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

// After a purge: forget what main has sent so the next pull starts from rev 0, and recount pending.
export const resetSync = async () => {
  setCursor(0);
  await refreshPending();
};

const driver = async () => (await getPhoneDb()).driver;

const CHECK_MS = 3_000; // a dead backend is known in this long, not a minute
const REQUEST_MS = 20_000; // sync payloads; nothing hangs longer than this
const ASK_MS = 120_000; // Claude takes a while to answer

const fetchWithTimeout = async (url: string, init: RequestInit, ms: number): Promise<Response> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const UNREACHABLE_MESSAGE = "Can't reach the server. Try again.";

// A cheap "is the backend there right now?" — one tiny GET with a short timeout. Sync and Ask call it
// first so an offline backend fails in seconds instead of hanging on the real request.
export const checkReachable = async (): Promise<boolean> => {
  try {
    return (await fetchWithTimeout(`${getBackendUrl()}/api/health`, { cache: "no-store" }, CHECK_MS)).ok;
  } catch {
    return false;
  }
};

// Throws (and flips the StatusPill to Unreachable at once) when the backend doesn't answer; a success
// clears the flag, so pressing Sync or Ask is also how "Unreachable" recovers.
const ensureReachable = async (): Promise<void> => {
  if (await checkReachable()) return void set({ unreachable: false });
  set({ unreachable: true, lastError: UNREACHABLE_MESSAGE });
  throw new Error(UNREACHABLE_MESSAGE);
};

const req = async <T>(path: string, init?: RequestInit, ms = REQUEST_MS): Promise<T> => {
  const res = await fetchWithTimeout(
    `${getBackendUrl()}${path}`,
    { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) } },
    ms,
  );
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    throw new Error(typeof error === "string" && error ? error : `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

// Push: this device's pending rows (no `rev` yet). Main returns them stamped, so applying the
// response is enough to clear them locally — no separate round-trip needed just for that.
const push = async (): Promise<number> => {
  const d = await driver();
  const body = await pendingChanges(d);
  const { changes, cursor } = await req<{ changes: Partial<Changes>; cursor: number }>("/api/push", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await applyChanges(d, changes);
  setCursor(cursor);
  return countChanges(body);
};

// Pull: rows main has that this device's cursor hasn't seen.
const pull = async (): Promise<number> => {
  const d = await driver();
  const since = getCursor();
  const { changes, cursor } = await req<{ changes: Partial<Changes>; cursor: number }>(`/api/changes?since=${since}`);
  await applyChanges(d, changes);
  setCursor(cursor);
  return TABLE_NAMES.reduce((n, t) => n + (changes[t]?.length ?? 0), 0);
};

// One push-then-pull cycle — "sync now", or the button behind keep-live's timer alike.
// A cycle that moved nothing doesn't signal a change: every mounted lens would re-read its whole query for no reason.
export const syncNow = async (): Promise<void> => {
  await ensureReachable();
  const sent = await push();
  const received = await pull();
  if (sent + received > 0) emitChange();
  idle(() => void pruneOldVersions().catch(() => {})); // retention (core/retention.ts), never on the sync's critical path
};

const idle = (fn: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn) : setTimeout(fn, 1000);

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
// Re-checks reachability on press (no loading state when it fails); disabled in the UI while `unreachable`,
// never queued.
export const ask = async (threadId: string, question: string): Promise<string> => {
  await ensureReachable();
  const d = await driver();
  await push();
  const { answer, changes, cursor } = await req<{ answer: string; changes: Partial<Changes>; cursor: number }>(
    "/api/ask",
    { method: "POST", body: JSON.stringify({ threadId, question }) },
    ASK_MS,
  );
  await applyChanges(d, changes);
  setCursor(cursor);
  emitChange();
  return answer;
};

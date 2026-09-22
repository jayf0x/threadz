import { format } from "date-fns";
import { fetchHead, postSync } from "./api";
import { pushImages } from "./imageSync";
import {
  commitPush,
  countUnsynced,
  exportSnapshot,
  getBase,
  localAnnotationIds,
  localMessageIds,
  markAnnotationsDirty,
  markDirty,
  mergeSnapshot,
  parseSnapshot,
  saveBackup,
  unsyncedBatch,
} from "./local";
import { replicaReady, setMode } from "./mode";
import { addReports, emptyReport, fetchAndMerge, type PullReport, pullMain } from "./replica";
import { emitChange } from "./sync";

// Moving between main and this device. Nothing here runs by itself: going live is a
// button, and nothing in this file removes a local note.

// --- live → local, on purpose --------------------------------------------------

// The device copy is kept warm while live, so this is just a fresh pull and a flip.
// (Being cut off from main does the same flip automatically — see `via` in api.ts.)
export const enterLocal = async () => {
  await pullMain().catch(() => {}); // best effort: even a slightly stale copy is a full copy
  if (!replicaReady()) throw new Error("Connect to main once first, so a copy can be made for offline use.");
  setMode("local");
  emitChange();
};

// --- local → live ---------------------------------------------------------------

export type SyncReport = PullReport & { pushed: number; skippedImages: number };
export type Phase = (text: string) => void;

const sameHeads = (base: Record<string, string>, main: Record<string, string>) => {
  const a = Object.keys(base);
  return a.length === Object.keys(main).length && a.every((id) => base[id] === main[id]);
};

// Reconcile the device with main until both agree. Each round:
//   1. pull      main's changes into the device copy (union; deletes vs edits → content wins)
//   2. push      photos main lacks (PUT per image), then everything pending, in ONE request (main backs itself up, applies atomically)
//   3. re-read   the threads we touched from main, prove every local note is there
//                (if not, it becomes pending again), and refresh our base hashes from them
//   4. compare   main's hashes with our base: equal = in sync
// Every step is idempotent, so a crash/reload/retry anywhere just resumes.
export const syncNow = async (phase?: Phase): Promise<SyncReport> => {
  await saveBackup("before-sync");
  let report: SyncReport = { ...emptyReport(), pushed: 0, skippedImages: 0 };
  const refused = new Set<string>(); // photos main turned down for good: they stay dirty on the device

  for (let round = 0; round < 4; round++) {
    phase?.("Reading main…");
    report = { ...addReports(report, await pullMain()), pushed: report.pushed, skippedImages: report.skippedImages };

    const batch = await unsyncedBatch();
    const base = await getBase();
    // A thread that was never on main (no base) needs no delete there.
    const deletes = batch.trash.flatMap((x) => {
      const baseHash = base[x.id];
      return baseHash ? [{ id: x.id, baseHash }] : [];
    });
    const pending =
      batch.threads.length +
      batch.messages.length +
      batch.annotations.length +
      batch.annotationDeletes.length +
      batch.trash.length;

    // Photos first: a note should not reach main ahead of its image. One main refuses is skipped, not fatal.
    for (const hash of (await pushImages()).skipped) refused.add(hash);
    report.skippedImages = refused.size;
    if (pending) {
      phase?.(`Sending ${pending} change${pending === 1 ? "" : "s"}…`);
      const result = await postSync({
        threads: batch.threads.map((t) => ({
          id: t.id,
          title: t.title,
          createdAt: t.createdAt,
          renamedAt: t.renamedAt ?? null,
        })),
        messages: batch.messages.map((m) => ({
          id: m.id,
          threadId: m.threadId,
          role: m.role,
          content: m.content,
          meta: m.meta,
          createdAt: m.createdAt,
          editedAt: m.editedAt ?? null,
          edits: m.edits ?? [],
        })),
        annotations: batch.annotations.map((a) => ({
          id: a.id,
          threadId: a.threadId,
          messageId: a.messageId,
          content: a.content,
          createdAt: a.createdAt,
          editedAt: a.editedAt ?? null,
          edits: a.edits ?? [],
        })),
        annotationDeletes: batch.annotationDeletes.map((d) => ({ id: d.id, baseVersion: d.baseVersion })),
        deletes,
      });
      await commitPush(batch, result);
      report.pushed += result.appended + result.created;

      phase?.("Verifying…");
      for (const id of Object.keys(result.hashes)) {
        const { mainIds, mainAnnotationIds } = await fetchAndMerge(id, result.hashes[id]);
        const lacking = [...(await localMessageIds(id))].filter((m) => !mainIds.has(m));
        if (lacking.length) await markDirty(lacking);
        const lackingAnnotations = [...(await localAnnotationIds(id))].filter((a) => !mainAnnotationIds.has(a));
        if (lackingAnnotations.length) await markAnnotationsDirty(lackingAnnotations);
      }
    }

    const left = await countUnsynced();
    if (
      !left.threads &&
      !left.messages &&
      !left.annotations &&
      !left.deletions &&
      sameHeads(await getBase(), (await fetchHead()).threads)
    )
      return report;
  }
  throw new Error("Main kept changing while syncing — nothing was lost; try again.");
};

// One sync at a time across tabs.
const withLock = <T>(fn: () => Promise<T>): Promise<T> =>
  navigator.locks
    ? navigator.locks.request("threadz-sync", { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error("Another tab is syncing right now.");
        return fn();
      })
    : fn();

// The only way back to live. Flips the mode only once main and this device provably agree.
export const goLive = (phase?: Phase) =>
  withLock(async () => {
    const report = await syncNow(phase);
    setMode("live");
    emitChange();
    return report;
  });

// --- backups ------------------------------------------------------------------

const EXPORTED_KEY = "threadz.lastExport";
export const lastExport = () => Number(localStorage.getItem(EXPORTED_KEY)) || null;

export const download = async (json: string, name: string) => {
  const file = new File([json], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] }); // iOS: straight to Files / AirDrop
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
    }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
};

const stamp = () => format(new Date(), "yyyy-MM-dd-HHmm");

export const exportBackup = async () => {
  if (await download(JSON.stringify(await exportSnapshot(), null, 1), `threadz-${stamp()}.json`))
    localStorage.setItem(EXPORTED_KEY, String(Date.now()));
};

// Union import: adds what's missing (marked for sync), touches nothing else.
export const importBackup = async (file: File) => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(await file.text());
  } catch {} // not JSON: rejected below with the rest
  const snap = parseSnapshot(raw);
  if (!snap) throw new Error("Not a Threadz backup file.");
  const added = await mergeSnapshot(snap);
  emitChange();
  return added;
};

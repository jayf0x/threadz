import { format, formatDistanceToNow } from "date-fns";
import { Download, HardDriveDownload, Upload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { download, enterLocal, exportBackup, goLive, importBackup, lastExport, type SyncReport } from "@/lib/handoff";
import { latestBackup } from "@/lib/local";
import { replicaReady } from "@/lib/mode";
import { closePanel, dismissNudge, openPanel, total, useStatus } from "@/lib/status";
import type { Unsynced } from "@/lib/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const describe = (u: Unsynced) =>
  [
    u.threads && plural(u.threads, "new thread"),
    u.messages && plural(u.messages, "note"),
    u.deletions && plural(u.deletions, "deletion"),
  ]
    .filter(Boolean)
    .join(" · ");

// One plain sentence per thing that happened, only for the things that did.
const report = (r: SyncReport) =>
  [
    r.pushed ? `Sent ${plural(r.pushed, "change")} to main.` : "Main already had everything.",
    r.threads && `Picked up ${plural(r.threads, "thread")} from main.`,
    r.removed &&
      `${plural(r.removed, "thread")} deleted on main ${r.removed === 1 ? "was" : "were"} removed here (copy kept in backups).`,
    r.keptLocal && `Kept ${plural(r.keptLocal, "thread")} deleted on main but edited here.`,
    r.keptRemote && `Kept ${plural(r.keptRemote, "thread")} deleted here but edited on main.`,
    "You're live.",
  ]
    .filter(Boolean)
    .join(" ");

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The one place mode changes happen. Nothing switches on its own: going local and
// going live are both buttons here, and going live syncs first.
export const ConnectionDialog = () => {
  const s = useStatus();
  const ref = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<ReactNode>(null); // result of the last action
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupAt, setBackupAt] = useState<number | null>(null);

  const local = s.mode === "local";
  const up = s.reachable;
  const pending = total(s.unsynced);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const goLocal = () =>
    run(async () => {
      await enterLocal();
      setNote("You're on this device's copy. Main only changes when you sync.");
    });

  const syncAndGoLive = () =>
    run(async () => {
      const r = await goLive(setPhase);
      setNote(report(r));
    });

  const onImport = (f: File | undefined) =>
    f &&
    run(async () => {
      const added = await importBackup(f);
      setNote(
        `Imported ${plural(added.threads, "thread")} and ${plural(added.messages, "note")}. They'll sync with the rest.`,
      );
    });

  const saveLatest = () =>
    run(async () => {
      const b = await latestBackup();
      if (b) await download(b.json, `threadz-safety-${format(b.id, "yyyy-MM-dd-HHmm")}.json`);
    });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (s.panel && !d.open) {
      d.showModal();
      navigator.storage?.persisted?.().then(setPersisted, () => {});
      latestBackup().then((b) => setBackupAt(b?.id ?? null));
    } else if (!s.panel && d.open) d.close();
  }, [s.panel]);

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby="conn-title"
        // Esc must not dismiss a running sync.
        onCancel={(e) => (busy ? e.preventDefault() : closePanel())}
        onClose={() => {
          setNote(null);
          setError(null);
          closePanel();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <div className="flex flex-col gap-5 px-6 py-6">
          <header>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {local ? "Local · this device" : up || !s.checked ? "Live · main" : "Live · offline"}
            </p>
            <h2 id="conn-title" className="mt-1 font-serif text-3xl leading-tight tracking-tight">
              {local
                ? up
                  ? "Main is back."
                  : "Working locally."
                : up || !s.checked
                  ? "Live on main."
                  : "Can't reach main."}
            </h2>
          </header>

          {note && <p className="border-l-2 border-primary pl-3 text-sm">{note}</p>}
          {error && (
            <p className="border-l-2 border-destructive pl-3 font-mono text-[11px] text-destructive">
              {error}
              {local && (
                <span className="block text-muted-foreground">
                  Nothing was lost — everything is still on this device. Retry when ready.
                </span>
              )}
            </p>
          )}

          {local ? (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This device holds the latest copy. Notes are saved here; main only changes when you sync, and syncing
                also brings in anything main gained meanwhile.
              </p>
              <p className="font-mono text-[11px] uppercase tracking-widest">
                {pending ? describe(s.unsynced) : "Nothing waiting to sync"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy || !up} onClick={syncAndGoLive}>
                  {busy ? (phase ?? "Syncing…") : pending ? "Sync & go live" : "Go live"}
                </Button>
                {!up && <span className="text-xs text-muted-foreground">Available when main is reachable.</span>}
              </div>
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {up || !s.checked
                  ? "Everything you write goes straight to main. If main drops away, the app carries on with this device's copy."
                  : replicaReady()
                    ? "Main isn't reachable."
                    : "Main isn't reachable, and this device has no copy yet. Connect once and it will make one."}
              </p>
              {pending > 0 && (
                <div className="border border-primary bg-accent p-3">
                  <p className="text-sm">{describe(s.unsynced)} from local work never reached main.</p>
                  <Button className="mt-2" size="sm" disabled={busy || !up} onClick={syncAndGoLive}>
                    {busy ? (phase ?? "Syncing…") : "Sync to main"}
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <div>
                  <Button variant="outline" disabled={busy} onClick={goLocal}>
                    <HardDriveDownload className="size-3.5" /> Work locally
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Switch to this device's copy on purpose — say, before you go offline. You choose when to sync back.
                </p>
              </div>
            </section>
          )}

          {local && (
            <section className="flex flex-col gap-2 border-t border-rule pt-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Backup</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(exportBackup)}>
                  <Download className="size-3.5" /> Export
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
                  <Upload className="size-3.5" /> Import
                </Button>
                <input
                  ref={file}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    onImport(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Last export: {lastExport() ? `${formatDistanceToNow(lastExport()!)} ago` : "never"}.{" "}
                {backupAt && (
                  <>
                    Safety copy from before your last sync ({formatDistanceToNow(backupAt)} ago){" "}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={saveLatest}
                    >
                      download
                    </button>
                    .{" "}
                  </>
                )}
                {persisted === false
                  ? "This browser may clear local storage if it's unused — export now and then."
                  : persisted && "Storage is protected from automatic clean-up."}
              </p>
            </section>
          )}

          <footer className="flex justify-end">
            <Button variant="ghost" disabled={busy} onClick={closePanel}>
              Close
            </Button>
          </footer>
        </div>
      </dialog>
      <Nudge />
    </>
  );
};

// Non-modal, so it never steals focus from a half-typed note. Appears once per
// "main came back"; Later leaves the pill pulsing instead.
const Nudge = () => {
  const s = useStatus();
  if (s.panel || s.mode !== "local") return null;
  const pending = total(s.unsynced);
  if (!s.nudge && !s.detached) return null;
  return (
    <div
      role="status"
      className="rise fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center justify-between gap-3 border border-primary bg-card px-4 py-3 shadow-lg"
    >
      {s.nudge ? (
        <>
          <p className="text-sm">
            <span className="font-serif text-base">Main is reachable.</span>{" "}
            <span className="text-muted-foreground">
              {pending ? `${plural(pending, "change")} to sync.` : "Nothing to sync."}
            </span>
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" onClick={openPanel}>
              Review
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissNudge}>
              Later
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-serif text-base">Main went away.</span>{" "}
            <span className="text-muted-foreground">You're on this device's copy — nothing is lost.</span>
          </p>
          <Button size="sm" variant="ghost" onClick={dismissNudge}>
            OK
          </Button>
        </>
      )}
    </div>
  );
};

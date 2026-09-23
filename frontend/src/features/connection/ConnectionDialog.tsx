import { HardDriveDownload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { errorMessage } from "@/lib/errors";
import { enterLocal, goLive } from "@/lib/handoff";
import { latestBackup } from "@/lib/local";
import { replicaReady } from "@/lib/mode";
import { closePanel, total, useStatus } from "@/lib/status";
import { BackupSection } from "./BackupSection";
import { describeReport, describeUnsynced } from "./connectionCopy";

// The one place mode changes happen. Nothing switches on its own: going local and
// going live are both buttons here, and going live syncs first.
export const ConnectionDialog = () => {
  const s = useStatus();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<ReactNode>(null); // result of the last action
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupAt, setBackupAt] = useState<number | null>(null);

  const local = s.mode === "local";
  const up = s.reachable;
  const mainOk = up || !s.checked; // not yet probed counts as fine
  const pending = total(s.unsynced);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const goLocal = () =>
    run(async () => {
      await enterLocal();
      setNote("Now working from this device. Sync when ready.");
    });

  const syncAndGoLive = () =>
    run(async () => {
      const r = await goLive(setPhase);
      setNote(describeReport(r));
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
          <Eyebrow>{local ? "Local" : mainOk ? "Live" : "Offline"}</Eyebrow>
          <h2 id="conn-title" className="mt-1 font-serif text-3xl leading-tight tracking-tight">
            {local ? (up ? "Back online." : "Working offline.") : mainOk ? "Connected." : "Can't connect."}
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
            <p className="text-sm text-muted-foreground">Notes save here until you sync.</p>
            <p className="font-mono text-[11px] uppercase tracking-widest">
              {pending ? describeUnsynced(s.unsynced) : "Nothing waiting to sync"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || !up} onClick={syncAndGoLive}>
                {busy ? (phase ?? "Syncing…") : pending ? "Sync & go live" : "Go live"}
              </Button>
              {!up && <span className="text-xs text-muted-foreground">Available once back online.</span>}
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {mainOk
                ? "Saves directly. Falls back to this device if the connection drops."
                : replicaReady()
                  ? "Can't connect. Working from the last saved copy."
                  : "Can't connect, and there's no copy yet. Connect once to make one."}
            </p>
            {pending > 0 && (
              <div className="border border-primary bg-accent p-3">
                <p className="text-sm">{describeUnsynced(s.unsynced)} not yet synced.</p>
                <Button className="mt-2" size="sm" disabled={busy || !up} onClick={syncAndGoLive}>
                  {busy ? (phase ?? "Syncing…") : "Sync now"}
                </Button>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <div>
                <Button variant="outline" disabled={busy} onClick={goLocal}>
                  <HardDriveDownload className="size-3.5" /> Work locally
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">You choose when to sync back.</p>
            </div>
          </section>
        )}

        {local && <BackupSection busy={busy} run={run} setNote={setNote} backupAt={backupAt} persisted={persisted} />}

        <footer className="flex justify-end">
          <Button variant="ghost" disabled={busy} onClick={closePanel}>
            Close
          </Button>
        </footer>
      </div>
    </dialog>
  );
};

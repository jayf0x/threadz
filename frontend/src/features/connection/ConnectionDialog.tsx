import { formatDistanceToNow } from "date-fns";
import { Download, HardDriveDownload, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { download, enterLocal, goLive } from "@/lib/handoff";
import { latestBackup } from "@/lib/local";
import { replicaReady } from "@/lib/mode";
import { closePanel, total, useStatus } from "@/lib/status";
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
      // A bottom sheet on a phone, a centred card from md (native <dialog>, styled with CSS only).
      className={cn(
        "m-0 mt-auto max-h-[calc(var(--vv-h,100dvh)-1rem)] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-card p-0",
        "surface-float text-card-foreground shadow-xl ring-1 ring-border backdrop:bg-foreground/40",
        "open:sheet-in md:m-auto md:w-[32rem] md:max-w-[calc(100vw-2rem)] md:rounded-2xl md:open:pop-in",
      )}
    >
      <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-border md:hidden" />
      <div className="pb-safe flex flex-col gap-5 px-5 pb-5 pt-4 md:px-6 md:py-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>{local ? "Local" : mainOk ? "Live" : "Offline"}</Eyebrow>
            <h2 id="conn-title" className="mt-1 font-serif text-3xl leading-tight tracking-tight">
              {local ? (up ? "Back online." : "Working offline.") : mainOk ? "Connected." : "Can't connect."}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            title="Close"
            disabled={busy}
            onClick={closePanel}
            className="-mr-2 -mt-1"
          >
            <X className="size-5 md:size-4" />
          </Button>
        </header>

        {note && <p className="border-l-2 border-primary pl-3 text-sm">{note}</p>}
        {error && (
          <p className="border-l-2 border-destructive pl-3 text-xs text-destructive">
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
            <div className="flex flex-wrap items-center gap-3">
              <Button className="w-full md:w-auto" disabled={busy || !up} onClick={syncAndGoLive}>
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
              <div className="flex flex-col gap-2 rounded-2xl border border-primary bg-accent p-3">
                <p className="text-sm">{describeUnsynced(s.unsynced)} not yet synced.</p>
                <Button size="sm" className="w-full md:w-fit" disabled={busy || !up} onClick={syncAndGoLive}>
                  {busy ? (phase ?? "Syncing…") : "Sync now"}
                </Button>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" className="w-full md:w-fit" disabled={busy} onClick={goLocal}>
                <HardDriveDownload className="size-5 md:size-4" /> Work locally
              </Button>
              <p className="px-1 text-xs text-muted-foreground">You choose when to sync back.</p>
            </div>
          </section>
        )}

        {local && backupAt && (
          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              Safety copy from before your last sync ({formatDistanceToNow(backupAt)} ago).{" "}
              {persisted === false && "This browser may clear local storage if it's unused — export now and then."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() =>
                run(async () => {
                  const b = await latestBackup();
                  if (b) await download(b.json, `threadz-safety-${b.id}.json`);
                })
              }
            >
              <Download className="size-5 md:size-4" /> Download
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
};

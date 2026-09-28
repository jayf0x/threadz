import { Download, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { getPhoneDb } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import { closePanel, manualSync, setKeepLive, useSyncStatus } from "@/lib/syncEngine";
import { describePending } from "./connectionCopy";

// The one place sync state changes happen (docs/direction.md "Sync" + "B7"): a manual "Sync now"
// button, and a "keep live" toggle that runs the same push-then-pull every 15s while the tab is
// visible. Replaces v1's go-live/go-local pair — there's no separate offline mode to switch into,
// the phone's own database is always what's on screen.
export const ConnectionDialog = () => {
  const s = useSyncStatus();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<ReactNode>(null);

  const sync = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await manualSync();
      setNote("Synced.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportDb = async () => {
    setBusy(true);
    setError(null);
    try {
      const db = await getPhoneDb();
      await db.exportFile();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (s.panel && !d.open) d.showModal();
    else if (!s.panel && d.open) d.close();
  }, [s.panel]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="conn-title"
      onCancel={(e) => (busy ? e.preventDefault() : closePanel())}
      onClose={() => {
        setNote(null);
        setError(null);
        closePanel();
      }}
      className={cn(
        "m-0 mt-auto max-h-[calc(var(--vv-h,100dvh)-1rem)] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-card p-0",
        "surface-float text-card-foreground shadow-xl ring-1 ring-border backdrop:bg-foreground/40",
        "open:sheet-in md:m-auto md:w-[32rem] md:max-w-[calc(100vw-2rem)] md:rounded-2xl md:open:pop-in",
      )}
    >
      <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-border md:hidden" />
      <div className="flex flex-col gap-5 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 md:px-6 md:py-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>{s.unreachable ? "Unreachable" : s.keepLive ? "Keep-live" : "Sync"}</Eyebrow>
            <h2 id="conn-title" className="mt-1 font-serif text-3xl leading-tight tracking-tight">
              {s.unreachable ? "Can't sync." : "This device."}
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
        {error && <p className="border-l-2 border-destructive pl-3 text-xs text-destructive">{error}</p>}

        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Notes always save here first.</p>
          <p className="text-xs tabular-nums text-muted-foreground">{describePending(s.pending)}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="w-full md:w-auto" disabled={busy} onClick={sync}>
              <RefreshCw className={cn("size-5 md:size-4", busy && "animate-spin")} />
              {busy ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3">
            <span className="min-w-0">
              <span className="block text-sm">Keep live</span>
              <span className="block text-xs text-muted-foreground">Sync automatically every 15s while open.</span>
            </span>
            <input
              type="checkbox"
              checked={s.keepLive}
              onChange={(e) => setKeepLive(e.target.checked)}
              className="size-5 shrink-0 accent-primary"
              aria-label="Keep live"
            />
          </label>
        </section>

        <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
          <p className="min-w-0 text-xs text-muted-foreground">A full snapshot of this device, as a `.sqlite` file.</p>
          <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={exportDb}>
            <Download className="size-5 md:size-4" /> Export
          </Button>
        </div>
      </div>
    </dialog>
  );
};

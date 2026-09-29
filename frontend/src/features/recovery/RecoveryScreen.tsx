import { Download, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_NAME, downloadBytes, type PhoneOpenError } from "@/lib/phoneDb";

// The IndexedDB databases behind the phone db: the file itself and the import scratch copy.
const DB_NAMES = [DEFAULT_NAME, "phone-import-scratch.sqlite"];
const SYNC_CURSOR_KEY = "threadz.rev"; // lib/syncEngine.ts's cursor: a fresh db must pull from rev 0

export const RecoveryScreen = ({ error }: { error: PhoneOpenError }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    await Promise.all(DB_NAMES.map(deleteDb));
    try {
      localStorage.removeItem(SYNC_CURSOR_KEY);
    } catch {}
    location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold">Can't open your data</h1>
        <p className="mt-2 break-words text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => location.reload()}>
            <RotateCcw className="size-5 md:size-4" /> Retry
          </Button>
          {error.rawDump && (
            <Button
              variant="outline"
              onClick={() =>
                error.rawDump &&
                downloadBytes(
                  error.rawDump,
                  `threadz-recovered-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
                )
              }
            >
              <Download className="size-5 md:size-4" /> Export what's readable
            </Button>
          )}
          {confirming ? (
            <>
              <p className="text-sm text-destructive">Erases everything on this device that isn't synced.</p>
              <div className="flex gap-2">
                <Button variant="danger" disabled={busy} onClick={reset}>
                  <Trash2 className="size-5 md:size-4" /> Erase and start over
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 className="size-5 md:size-4" /> Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const deleteDb = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

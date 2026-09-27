import { formatDistanceToNow } from "date-fns";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getPhoneDb } from "@/lib/data";
import { Section } from "./SettingsSection";

const EXPORTED_KEY = "threadz.lastExport";
const lastExport = () => Number(localStorage.getItem(EXPORTED_KEY)) || null;

// Low-usage, so it lives at the bottom of Settings. Export/import is now a real `.sqlite` file
// (docs/direction.md "Device storage and export"), not a JSON snapshot: export is
// `phoneDb.exportFile()` (a plain browser download/share), import merges a file's rows in with the
// same insert-if-missing/last-write-wins rules a sync push uses (`phoneDb.importFile`, backed by
// `core`'s `applyChanges`).
export const DataSection = () => {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState(lastExport);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Import / export">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const db = await getPhoneDb();
              await db.exportFile();
              localStorage.setItem(EXPORTED_KEY, String(Date.now()));
              setExportedAt(lastExport());
            })
          }
        >
          <Download className="size-5 md:size-4" /> Export
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => file.current?.click()}>
          <Upload className="size-5 md:size-4" /> Import
        </Button>
        <input
          ref={file}
          type="file"
          accept=".sqlite,application/x-sqlite3"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              run(async () => {
                const db = await getPhoneDb();
                const { imported } = await db.importFile(f);
                setNote(`Imported ${imported} row${imported === 1 ? "" : "s"}.`);
              });
          }}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Photos aren't included — an export holds notes and their photo references, not the pictures.
      </p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {note ?? `Last export: ${exportedAt ? `${formatDistanceToNow(exportedAt)} ago` : "never"}.`}
      </p>
    </Section>
  );
};

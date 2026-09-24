import { formatDistanceToNow } from "date-fns";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { exportBackup, importBackup, lastExport } from "@/lib/handoff";
import { Section } from "./SettingsSection";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Low-usage, so it lives at the bottom of Settings rather than in the sync dialog it used to share
// a footer with. Works in either mode: import is a union merge (`mergeSnapshot`), export a plain
// snapshot download — neither depends on being local or live.
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
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await exportBackup();
              setExportedAt(lastExport());
            })
          }
        >
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
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              run(async () => {
                const added = await importBackup(f);
                setNote(`Imported ${plural(added.threads, "thread")} and ${plural(added.messages, "note")}.`);
              });
          }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Photos aren't included — an export holds notes and their photo references, not the pictures.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {note ?? `Last export: ${exportedAt ? `${formatDistanceToNow(exportedAt)} ago` : "never"}.`}
      </p>
    </Section>
  );
};

import { format, formatDistanceToNow } from "date-fns";
import { Download, Upload } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { download, exportBackup, importBackup, lastExport } from "@/lib/handoff";
import { latestBackup } from "@/lib/local";
import { plural } from "./connectionCopy";

type Props = {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  setNote: (note: ReactNode) => void;
  backupAt: number | null;
  persisted: boolean | null;
};

export const BackupSection = ({ busy, run, setNote, backupAt, persisted }: Props) => {
  const file = useRef<HTMLInputElement>(null);
  const [exportedAt, setExportedAt] = useState(lastExport);

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

  return (
    <section className="flex flex-col gap-2 border-t border-rule pt-4">
      <Eyebrow>Backup</Eyebrow>
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
            onImport(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Last export: {exportedAt ? `${formatDistanceToNow(exportedAt)} ago` : "never"}.{" "}
        {backupAt && (
          <>
            Safety copy from before your last sync ({formatDistanceToNow(backupAt)} ago){" "}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={saveLatest}>
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
  );
};

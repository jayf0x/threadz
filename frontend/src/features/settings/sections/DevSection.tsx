import { Database, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { onChange } from "@/lib/changeSignal";
import { addSampleData, liveCounts, purgeDatabase } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import { resetSync } from "@/lib/syncEngine";
import { Section } from "./SettingsSection";

// Local QA on a device that starts empty: pile on sample data (core/seed.ts, a fresh batch per press) to see
// where the database or a lens breaks, or wipe this device's data. Errors are shown here, not swallowed.
export const DevSection = () => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [counts, setCounts] = useState<{ threads: number; notes: number } | null>(null);

  const refresh = useCallback(() => {
    liveCounts()
      .then(setCounts)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return onChange(refresh);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run("Adding", async () => {
      const total = await addSampleData((done, all) => setBusy(`Adding ${Math.round((done / all) * 100)}%`));
      toast({ title: `Added ${total} rows` });
    });

  const purge = () => {
    setConfirm(false);
    return run("Purging", async () => {
      await purgeDatabase();
      await resetSync();
      toast({ title: "Database purged" });
    });
  };

  return (
    <Section title="Dev">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!!busy} onClick={add}>
          <Database className="size-5 md:size-4" /> {busy?.startsWith("Adding") ? busy : "Add 50 threads"}
        </Button>
        <Button variant="danger" disabled={!!busy} onClick={() => setConfirm(true)}>
          <Trash2 className="size-5 md:size-4" /> {busy === "Purging" ? busy : "Purge"}
        </Button>
      </div>
      <p className="mt-3 text-xs tabular-nums text-muted-foreground">
        {counts ? `${counts.threads} threads, ${counts.notes} notes` : "…"}
      </p>
      {error && <p className="mt-1 break-words text-xs text-destructive">{error}</p>}

      <Sheet open={confirm} onOpenChange={setConfirm} title="Purge database">
        <p className="text-sm">
          Delete every thread, note and photo on this device only? Nothing on the server changes.
        </p>
        <div className="mt-4 flex gap-2 pb-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" onClick={purge}>
            <Trash2 className="size-5 md:size-4" /> Purge
          </Button>
        </div>
      </Sheet>
    </Section>
  );
};

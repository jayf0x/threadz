import { format } from "date-fns";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import type { TrashedThread } from "@/lib/local";
import { useTrash } from "./useTrash";

// The sidebar's Bin view: every thread still sitting in this device's own trash (lib/local.ts's
// `trash` store), newest deletion first, one restore action per row — same list/row shape as
// TodosPanel, a button instead of a checkbox. See lib/handoff.ts's `restoreThread` for what
// "restore" means live vs local (AGENTS.md's Local mode note: main keeps no trash of its own, so a
// live restore only ever works for a thread this device still has a copy of from before its delete
// synced). A restored row disappears from this list on its own — `useTrash`'s `onChange` subscription
// re-reads `trash` once the restore's write lands.
export const TrashPanel = ({ onRestored }: { onRestored: (threadId: string) => void }) => {
  const { trash, restore } = useTrash();

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Bin</h1>
        <Eyebrow className="mt-2">
          {trash === null ? "Reading…" : `${trash.length} thread${trash.length === 1 ? "" : "s"}`}
        </Eyebrow>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {trash?.length === 0 && (
          <p className="px-5 py-12 font-serif text-lg italic text-muted-foreground">The bin is empty.</p>
        )}
        <ul>
          {trash?.map((t) => (
            <TrashRow key={t.id} thread={t} onRestore={() => restore(t.id).then(() => onRestored(t.id))} />
          ))}
        </ul>
      </div>
    </>
  );
};

const TrashRow = ({ thread, onRestore }: { thread: TrashedThread; onRestore: () => Promise<void> }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRestore();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
    // no `finally`: a successful restore also navigates away (onRestored), so there's
    // nothing left here to un-busy — this row is about to disappear from the list.
  };

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-b border-rule px-5 py-3.5">
      <span className="min-w-0">
        <span className="block truncate font-serif text-lg leading-snug">{thread.title}</span>
        <span className="mt-1 block font-mono text-[11px] uppercase text-muted-foreground">
          Deleted {format(thread.deletedAt, "d MMM, HH:mm")}
        </span>
        {error && <span className="mt-1 block font-mono text-[11px] text-destructive">{error}</span>}
      </span>
      <button
        type="button"
        aria-label="Restore thread"
        title="Restore"
        disabled={busy}
        className={cn(
          "-mr-2.5 shrink-0 p-2.5 text-muted-foreground transition-colors hover:text-foreground md:mr-0 md:p-1.5",
          "disabled:opacity-60",
        )}
        onClick={restore}
      >
        <RotateCcw className={cn("size-4 md:size-3.5", busy && "animate-spin")} />
      </button>
    </li>
  );
};

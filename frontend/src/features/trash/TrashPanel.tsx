import { format } from "date-fns";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Empty } from "@/components/ui/empty";
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
      <header className="px-5 pb-3 pt-6">
        <h1 className="font-serif text-[32px] leading-none tracking-tight">Bin</h1>
        <Eyebrow className="mt-2">
          {trash === null ? "Reading…" : `${trash.length} thread${trash.length === 1 ? "" : "s"}`}
        </Eyebrow>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-6">
        {trash?.length === 0 && <Empty icon={Trash2}>Empty</Empty>}
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
    <li className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-2 border-b border-rule py-2 pl-5 pr-2">
      <span className="min-w-0">
        <span className="line-clamp-2 break-words font-serif text-lg leading-snug">{thread.title}</span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {format(thread.deletedAt, "d MMM")}
        </span>
        {error && <span className="mt-0.5 block text-xs text-destructive">{error}</span>}
      </span>
      <button
        type="button"
        aria-label="Restore thread"
        title="Restore"
        disabled={busy}
        className={cn(
          "press-icon grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none md:size-9",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        )}
        onClick={restore}
      >
        <RotateCcw aria-hidden className={cn("size-5 md:size-4", busy && "animate-spin")} />
      </button>
    </li>
  );
};

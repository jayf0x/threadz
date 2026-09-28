import { format } from "date-fns";
import { ArrowLeft, MessageSquare, Plus, Send, Waves } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Menu } from "@/components/ui/menu";
import { createOrReuseThread } from "@/features/threads";
import { cn } from "@/lib/cn";
import type { PoolItem } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import type { Thread } from "@/lib/types";
import { usePool } from "./usePool";

// The sidebar's Pool view (docs/direction.md "Round 6" + "Lenses": "notes with no live message → a
// shelf of loose ideas; not a home screen"). Reached from the thread list (ThreadList.tsx's header
// button), never a fifth tab — the sidebar's own tab bar (index/todos/bin/settings) stays at four,
// so unlike those three panels this one isn't reachable from it and needs its own way back. Each
// card is a note with no live placement anywhere (`core.pool`); its one action sends it into a
// thread as a new message, which is exactly the write that removes it from this list
// (`placeExistingNote` in lib/data.ts).
export const PoolPanel = ({
  onBack,
  onOpenThread,
}: {
  onBack: () => void;
  onOpenThread: (threadId: string, messageId?: string) => void;
}) => {
  const { notes, threads, sendToThread } = usePool();

  return (
    <>
      <header className="px-2 pb-3 pt-6 md:px-5">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Back to index" className="shrink-0" onClick={onBack}>
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="pl-1 font-serif text-[32px] leading-none tracking-tight">Pool</h1>
        </div>
        <Eyebrow className="mt-2 pl-1">
          {notes === null ? "Reading…" : `${notes.length} loose note${notes.length === 1 ? "" : "s"}`}
        </Eyebrow>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-6">
        {notes?.length === 0 && <Empty icon={Waves}>Nothing loose</Empty>}
        <ul>
          {notes?.map((note) => (
            <PoolRow
              key={note.entityId}
              note={note}
              threads={threads}
              onSend={async (threadId) => {
                const messageId = await sendToThread(note.entityId, threadId);
                onOpenThread(threadId, messageId);
              }}
            />
          ))}
        </ul>
      </div>
    </>
  );
};

const PoolRow = ({
  note,
  threads,
  onSend,
}: {
  note: PoolItem;
  threads: Thread[];
  onSend: (threadId: string) => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (threadId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSend(threadId);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
    // no `finally` on success: `onSend` navigates away, so there's nothing left here to un-busy.
  };

  return (
    <li className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-2 border-b border-rule py-2 pl-5 pr-2">
      <span className="min-w-0">
        <span className="line-clamp-3 break-words font-serif text-lg leading-snug">{note.content || "Empty note"}</span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {format(note.createdAt, "d MMM")}
        </span>
        {error && <span className="mt-0.5 block text-xs text-destructive">{error}</span>}
      </span>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Send to thread"
            title="Send to thread"
            disabled={busy}
            className={cn(
              "press-icon grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none md:size-9",
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            )}
          >
            <Send aria-hidden className="size-5 md:size-4" />
          </button>
        }
        items={() => [
          {
            label: "New thread",
            icon: Plus,
            onClick: () => {
              void (async () => send(await createOrReuseThread()))();
            },
          },
          ...threads.map((t) => ({
            label: t.title,
            icon: MessageSquare,
            onClick: () => void send(t.id),
          })),
        ]}
      />
    </li>
  );
};

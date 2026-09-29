import { format } from "date-fns";
import { Check, GitFork, Pin } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { ResponsiveOverlay } from "@/components/ui/responsive-overlay";
import { toast } from "@/components/ui/toast";
import { MarkdownEditor } from "@/features/editor";
import { onChange } from "@/lib/changeSignal";
import { cn } from "@/lib/cn";
import { keepVersion, noteIdOfMessage, noteVersions } from "@/lib/data";
import { errorMessage } from "@/lib/errors";

type Versions = Awaited<ReturnType<typeof noteVersions>>;

// A message's note history (newest first) with a read-only preview and "Keep this version", which writes
// the chosen content as a new version on top of every head. `conflicted` also shows the conflict chip that
// opens this overlay; otherwise it opens from the message's ⋯ menu (`open` is the caller's).
export const VersionHistory = ({
  messageId,
  open,
  onOpenChange,
  conflicted,
}: {
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicted: boolean;
}) => (
  <>
    {conflicted && (
      <div className="-mb-1.5 mt-0.5" data-row-select-ignore="">
        <Chip
          colorSlot={2}
          icon={GitFork}
          label="Conflict"
          title="Two devices edited this note"
          aria-label="Edit conflict: open version history"
          onClick={() => onOpenChange(true)}
        />
      </div>
    )}
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      anchor={<span aria-hidden className="sr-only" />}
      title="Version history"
      anchorTo={<span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-0" />}
      align="end"
    >
      {open && <History messageId={messageId} onClose={() => onOpenChange(false)} />}
    </ResponsiveOverlay>
  </>
);

const History = ({ messageId, onClose }: { messageId: string; onClose: () => void }) => {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Versions>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const id = noteId ?? (await noteIdOfMessage(messageId));
    if (!id) return;
    setNoteId(id);
    setVersions(await noteVersions(id));
  }, [messageId, noteId]);

  useEffect(() => {
    load().catch(() => {});
    return onChange(() => void load().catch(() => {}));
  }, [load]);

  const conflicted = versions.filter((v) => v.isHead).length > 1;
  const shown = versions.find((v) => v.id === picked) ?? versions[0];
  const canKeep = !!shown && !!noteId && (conflicted || !shown.isHead);

  const keep = async () => {
    if (!shown || !noteId) return;
    setBusy(true);
    try {
      await keepVersion(noteId, shown.id);
      onClose();
    } catch (e) {
      toast({ title: "Couldn't keep version", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
      {conflicted && <p className="text-sm text-muted-foreground">Two devices edited this. Pick the one to keep.</p>}
      <ul className="flex flex-col">
        {versions.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              aria-pressed={v.id === shown?.id}
              aria-label={`Version from ${format(v.created_at, "d MMM HH:mm")}`}
              onClick={() => setPicked(v.id)}
              className={cn(
                "press-row flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                v.id === shown?.id && "bg-accent",
              )}
            >
              <time className="tabular-nums">{format(v.created_at, "d MMM HH:mm")}</time>
              {v.isHead && <span className="text-xs text-muted-foreground">{conflicted ? "branch" : "current"}</span>}
              {v.pinned && <Pin className="size-4 text-muted-foreground" aria-label="pinned" />}
              {v.rev == null && <span className="text-xs text-muted-foreground">this device</span>}
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="rounded-2xl border border-border p-3">
          <MarkdownEditor readOnly value={shown.content} className="[--md-padding:0]" />
        </div>
      )}
      <div className="flex min-h-11 items-center justify-end">
        <Button aria-label="Keep this version" title="Keep this version" disabled={!canKeep || busy} onClick={keep}>
          <Check className="size-5 md:size-4" /> Keep this version
        </Button>
      </div>
    </div>
  );
};

import { format, isThisYear } from "date-fns";
import { Check, Download, Pencil, Pin, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { PencilSparkles } from "@/components/ui/pencil-sparkles";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { exportThreadMarkdown } from "@/lib/exportMarkdown";
import { download, restoreThread } from "@/lib/handoff";
import { pullThreads } from "@/lib/sync";
import { setThreadFlag, useThreadFlag } from "@/lib/threadFlags";
import type { Thread } from "@/lib/types";
import { noteText, titleFrom } from "./titles";

// Filesystem-safe stand-in for whatever the title can't carry (path separators, quotes, wildcards).
// Collapsed to one dash rather than dropped, so "a/b" and "a b" don't collide on "ab".
const filenameFrom = (title: string) => {
  const slug = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${slug || "thread"}.md`;
};

export const ThreadRow = ({
  thread,
  active,
  onClick,
  onDeleted,
}: {
  thread: Thread;
  active: boolean;
  onClick: () => void;
  onDeleted: (id: string) => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // a quiet answer that is not a failure
  const [naming, setNaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The input's blur fires as it unmounts (after Enter or Esc): one rename per edit, and none after Esc.
  const settled = useRef(false);
  const pinned = useThreadFlag("pinned", thread.id);
  const resolved = useThreadFlag("resolved", thread.id);

  const rename = async () => {
    if (settled.current) return;
    settled.current = true;
    const next = title.trim();
    setRenaming(false);
    if (!next || next === thread.title) return;
    try {
      await api.renameThread(thread.id, next);
      await pullThreads();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Name the thread from what is in it (yatefca). Too little to go on, or no better than the current title: nothing changes.
  const regenerate = async () => {
    if (naming) return;
    setNaming(true);
    setError(null);
    setNote(null);
    try {
      const { messages } = await api.getThread(thread.id);
      const title = await titleFrom(noteText(messages));
      if (!title || title === thread.title) {
        setNote(title ? "Already named for what it says." : "Not enough written to name it yet.");
        setTimeout(() => setNote(null), 3500);
        return;
      }
      await api.renameThread(thread.id, title);
      await pullThreads();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setNaming(false);
    }
  };

  // Portable markdown, not the whole-vault JSON backup (BackupSection.tsx) — this thread's own
  // content, fetched the same mode-aware way as everywhere else (`api.getThread`, live or local via
  // `api.ts`'s `via()`), handed to the already-tested pure formatter, then saved with the same
  // `download` helper the vault export uses.
  const exportMarkdown = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const { messages, annotations } = await api.getThread(thread.id);
      const md = exportThreadMarkdown(thread, messages, annotations);
      await download(md, filenameFrom(thread.title), "text/markdown");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  // Non-destructive underneath (`trash`, see AGENTS.md's Local mode note) — delete right away and
  // offer a way back instead of a confirm() gate in front of it. `onClick` (this row's own "open
  // it" callback) doubles as Undo's landing action: restoring the thread and reopening it is the
  // same "open this thread" either way.
  const del = async () => {
    setError(null);
    try {
      await api.deleteThread(thread.id);
      await pullThreads().catch(() => {}); // drop it from the index
      onDeleted(thread.id);
      toast({
        title: "Thread deleted",
        description: thread.title,
        action: {
          label: "Undo",
          onClick: () => {
            restoreThread(thread.id).then(onClick, (e) =>
              toast({ title: "Restore failed", description: errorMessage(e) }),
            );
          },
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const act =
    "p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

  return (
    <div
      className={cn(
        "group relative border-b border-rule transition-colors",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      {renaming ? (
        <form
          className="px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <Input
            autoFocus
            aria-label="Thread title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              settled.current = true;
              setTitle(thread.title);
              setRenaming(false);
            }}
          />
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={onClick}
            aria-current={active}
            className="grid w-full grid-cols-[2.75rem_1fr] gap-x-3 px-5 py-3.5 text-left"
          >
            <span className="font-mono text-[11px] uppercase leading-tight text-muted-foreground">
              <span className="block font-serif text-xl normal-case leading-none text-foreground">
                {format(thread.updatedAt, "d")}
              </span>
              {format(thread.updatedAt, "MMM")}
              {!isThisYear(thread.updatedAt) && <span className="block">{format(thread.updatedAt, "yyyy")}</span>}
            </span>
            <span className="min-w-0 pr-40">
              <span className="block truncate font-serif text-lg leading-snug">
                {resolved && (
                  <Check aria-hidden className="mr-1 inline size-3.5 shrink-0 align-[-2px] text-muted-foreground" />
                )}
                {thread.title}
              </span>
              {note && <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{note}</span>}
              {error && <span className="mt-1 block font-mono text-[11px] text-destructive">{error}</span>}
            </span>
          </button>
          <div className="absolute right-2 top-2.5 flex">
            <button
              type="button"
              aria-label={pinned ? "Unpin thread" : "Pin thread"}
              title={pinned ? "Unpin" : "Pin"}
              className={cn(act, pinned && "opacity-100 text-primary")}
              onClick={() => setThreadFlag("pinned", thread.id, !pinned)}
            >
              <Pin className={cn("size-3.5", pinned && "fill-current")} />
            </button>
            <button
              type="button"
              aria-label={resolved ? "Mark unresolved" : "Mark resolved"}
              title={resolved ? "Mark unresolved" : "Mark resolved"}
              className={cn(act, resolved && "opacity-100 text-primary")}
              onClick={() => setThreadFlag("resolved", thread.id, !resolved)}
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Rename thread"
              title="Rename"
              className={act}
              onClick={() => {
                settled.current = false;
                setTitle(thread.title);
                setError(null);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Regenerate title"
              title="Regenerate title from its notes"
              disabled={naming}
              className={cn(act, naming && "opacity-100")}
              onClick={regenerate}
            >
              <PencilSparkles className={cn("size-3.5", naming && "animate-pulse")} />
            </button>
            <button
              type="button"
              aria-label="Export as Markdown"
              title="Export as Markdown"
              disabled={exporting}
              className={cn(act, exporting && "opacity-100")}
              onClick={exportMarkdown}
            >
              <Download className={cn("size-3.5", exporting && "animate-pulse")} />
            </button>
            <button
              type="button"
              aria-label="Delete thread"
              title="Delete"
              className={cn(act, "hover:text-destructive")}
              onClick={del}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

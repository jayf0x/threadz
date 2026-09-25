import { format, isThisYear } from "date-fns";
import { Download, Link, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { PencilSparkles } from "@/components/ui/pencil-sparkles";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { exportThreadMarkdown } from "@/lib/exportMarkdown";
import { download, restoreThread } from "@/lib/handoff";
import { buildReferenceHref } from "@/lib/references";
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

  // Ready to paste straight into another note — same `[text](thread=…)` shape the References
  // autocomplete itself produces (lib/references.ts), not a bare URL.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`[${thread.title}](${buildReferenceHref(thread.id)})`);
      toast({ title: "Link copied" });
    } catch (e) {
      toast({ title: "Copy failed", description: errorMessage(e) });
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

  // 44px round hit areas on a phone (where these are always visible), the compact desktop size from `md`,
  // where they appear on hover/focus only.
  const act = cn(
    "press-icon grid size-11 place-items-center rounded-full text-muted-foreground outline-none md:size-9",
    "hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
  );
  const icon = "size-5 md:size-4";

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
          className="flex min-h-16 items-center px-5 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <Input
            autoFocus
            aria-label="Thread title"
            placeholder="Title"
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
            className="press-row grid min-h-16 w-full grid-cols-[3rem_1fr] items-center gap-x-3 px-5 py-2.5 text-left"
          >
            <span className="font-mono text-[11px] uppercase leading-tight text-muted-foreground">
              <span className="block font-serif text-xl normal-case leading-none text-foreground tabular-nums">
                {format(thread.updatedAt, "d")}
              </span>
              {format(thread.updatedAt, isThisYear(thread.updatedAt) ? "MMM" : "MMM ’yy")}
            </span>
            <span className="min-w-0 pr-24 md:pr-[4.75rem]">
              <span
                className={cn(
                  "line-clamp-2 break-words font-serif text-[18px] leading-snug md:line-clamp-1",
                  naming && "animate-pulse",
                )}
              >
                {thread.title}
              </span>
              {note && <span className="mt-1 block text-xs text-muted-foreground">{note}</span>}
              {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
            </span>
          </button>
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 md:right-2">
            <button
              type="button"
              aria-label={pinned ? "Unpin thread" : "Pin thread"}
              aria-pressed={pinned}
              title={pinned ? "Unpin" : "Pin"}
              className={cn(act, pinned && "text-primary opacity-100")}
              onClick={() => setThreadFlag("pinned", thread.id, !pinned)}
            >
              <Pin className={cn(icon, pinned && "fill-current")} />
            </button>
            <Menu
              align="end"
              trigger={
                <button type="button" aria-label="Thread actions" title="Thread actions" className={act}>
                  <MoreHorizontal className={icon} />
                </button>
              }
              items={[
                {
                  label: "Rename",
                  icon: Pencil,
                  onClick: () => {
                    settled.current = false;
                    setTitle(thread.title);
                    setError(null);
                    setRenaming(true);
                  },
                },
                { label: "Regenerate title", icon: PencilSparkles, onClick: regenerate },
                { label: "Export as Markdown", icon: Download, onClick: exportMarkdown },
                { label: "Copy link", icon: Link, onClick: copyLink },
                { label: "Delete", icon: Trash2, onClick: del, destructive: true },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
};

import { format, isThisYear } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { getMode } from "@/lib/mode";
import { pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";

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
  // The input's blur fires as it unmounts (after Enter or Esc): one rename per edit, and none after Esc.
  const settled = useRef(false);

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

  const del = async () => {
    const warn =
      getMode() === "local"
        ? "Delete this thread? It leaves this device now and main on the next sync. A copy stays in your backups."
        : "Delete this thread? This cannot be undone.";
    if (!confirm(warn)) return;
    try {
      await api.deleteThread(thread.id);
      await pullThreads().catch(() => {}); // drop it from the index
      onDeleted(thread.id);
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
            <span className="min-w-0 pr-14">
              <span className="block truncate font-serif text-lg leading-snug">{thread.title}</span>
              {thread.description && (
                <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">
                  {thread.description}
                </span>
              )}
              {thread.tags.length > 0 && (
                <span className="mt-1.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {thread.tags.map((t) => `#${t}`).join("  ")}
                </span>
              )}
              {error && <span className="mt-1 block font-mono text-[11px] text-destructive">{error}</span>}
            </span>
          </button>
          <div className="absolute right-2 top-2.5 flex">
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

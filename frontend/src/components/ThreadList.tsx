import { format, isThisYear } from "date-fns";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { type Sort, useThreads } from "@/hooks/useThreads";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMode } from "@/lib/mode";
import { pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";

const SORTS: { value: Sort; label: string }[] = [
  { value: "updated", label: "Recent" },
  { value: "created", label: "Newest" },
  { value: "title", label: "A–Z" },
];

// The index: every thread as a row in a ledger. Also owns the "/" and "n" shortcuts.
export const ThreadList = ({
  onOpen,
  onDeleted,
  selectedId,
}: {
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
  selectedId?: string | null;
}) => {
  const { threads, query, setQuery, sort, setSort, syncing, error, refresh } = useThreads();
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
        return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "n") {
        e.preventDefault();
        setCreating(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pb-4 pt-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-4xl leading-none tracking-tight">Threadz</h1>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Index · {threads.length} thread{threads.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
            {creating ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {creating ? "Cancel" : "New"}
          </Button>
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            ref={search}
            className="min-w-0 flex-1"
            type="search"
            aria-label="Search threads"
            placeholder="Search  ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
          />
          <Select aria-label="Sort threads" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      {creating && <NewThread onClose={() => setCreating(false)} onCreated={onOpen} />}

      {error && <p className="border-y border-destructive px-5 py-2 font-mono text-[11px] text-destructive">{error}</p>}

      <ul className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {threads.map((t, i) => (
          <li key={t.id} className="rise" style={{ "--i": Math.min(i, 14) } as CSSProperties}>
            <ThreadRow thread={t} active={t.id === selectedId} onClick={() => onOpen(t.id)} onDeleted={onDeleted} />
          </li>
        ))}
        {threads.length === 0 && !syncing && (
          <li className="px-5 py-12 font-serif text-lg italic text-muted-foreground">
            {query ? "Nothing matches." : "Empty index. Press n to start a thread."}
          </li>
        )}
      </ul>

      <footer className="flex items-center justify-between border-t border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <StatusPill />
          {getMode() === "live" && (
            <button
              type="button"
              onClick={refresh}
              disabled={syncing}
              aria-label="Sync now"
              title="Sync now"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
            </button>
          )}
        </div>
        <ThemeToggle />
      </footer>
    </div>
  );
};

const ThreadRow = ({
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

  const rename = async () => {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === thread.title) return;
    try {
      await api.renameThread(thread.id, next);
      await pullThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
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

const NewThread = ({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) => {
  const [title, setTitle] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const thread = await api.createThread({ title: title.trim(), seed: seed.trim() || undefined });
      await pullThreads();
      onCreated(thread.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rise flex flex-col gap-3 border-t border-rule bg-card px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <Field
        label="Title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={error ?? undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seed" className="text-sm font-medium">
          Seed <span className="font-normal text-muted-foreground">— optional notes to start from</span>
        </label>
        <Textarea id="seed" className="h-24" value={seed} onChange={(e) => setSeed(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy || !title.trim()}>
        {busy ? "Creating…" : "Create thread"}
      </Button>
    </form>
  );
};

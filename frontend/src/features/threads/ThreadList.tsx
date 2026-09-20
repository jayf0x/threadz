import { Plus, RefreshCw, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { StatusPill } from "@/features/connection";
import { cn } from "@/lib/cn";
import { isTypingTarget } from "@/lib/dom";
import { getMode } from "@/lib/mode";
import { NewThread } from "./NewThread";
import { ThreadRow } from "./ThreadRow";
import { useThreads } from "./useThreads";
import { isSort, SORTS } from "./visibleThreads";

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
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
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
            <Eyebrow className="mt-2">
              Index · {threads.length} thread{threads.length === 1 ? "" : "s"}
            </Eyebrow>
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
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setQuery("");
              e.currentTarget.blur();
            }}
          />
          <Select
            aria-label="Sort threads"
            value={sort}
            onChange={(e) => {
              if (isSort(e.target.value)) setSort(e.target.value);
            }}
          >
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

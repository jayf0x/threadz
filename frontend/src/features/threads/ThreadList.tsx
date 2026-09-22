import { Plus, RefreshCw, Settings } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { StatusPill } from "@/features/connection";
import { SettingsPanel } from "@/features/settings";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getThreadMessages, getThreads } from "@/lib/db";
import { shortcutBlocked } from "@/lib/dom";
import { errorMessage } from "@/lib/errors";
import { getMode } from "@/lib/mode";
import { pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";
import { ThreadRow } from "./ThreadRow";
import { isPlaceholderTitle, nextTitle } from "./titles";
import { useThreads } from "./useThreads";
import { isSort, SORTS } from "./visibleThreads";

// The sidebar: every thread as a row in a ledger, and the settings it flips to. Also owns the "/" and "n" shortcuts.
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const starting = useRef(false); // "n" held down must not start a second thread before `creating` renders
  const search = useRef<HTMLInputElement>(null);

  // No form: a thread exists the moment you ask for one, named by its number, and you land in it.
  // But not a second empty one in a row: if the newest thread is still an untouched placeholder
  // (auto-generated title, no notes yet), reuse it instead of leaving another behind.
  const create = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const existing = await getThreads();
      const newest = existing.reduce<Thread | undefined>(
        (best, t) => (!best || t.createdAt > best.createdAt ? t : best),
        undefined,
      );
      if (newest && isPlaceholderTitle(newest.title) && (await getThreadMessages(newest.id)).length === 0) {
        onOpen(newest.id);
        return;
      }
      const title = nextTitle(existing.map((t) => t.title));
      const thread = await api.createThread({ title });
      await pullThreads();
      onOpen(thread.id);
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      starting.current = false;
      setCreating(false);
    }
  }, [onOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || shortcutBlocked(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "n" && !e.repeat) {
        e.preventDefault();
        create();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [create]);

  const failure = error ?? createError;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <View shown={!settingsOpen} from="left">
          <header className="px-5 pb-4 pt-6">
            <div className="flex items-end justify-between">
              <div>
                <h1 className="font-serif text-4xl leading-none tracking-tight">Threadz</h1>
                <Eyebrow className="mt-2">
                  Index · {threads.length} thread{threads.length === 1 ? "" : "s"}
                </Eyebrow>
              </div>
              <Button
                size="icon"
                aria-label="New thread"
                title="New thread (n)"
                disabled={creating}
                className="group size-10 shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:shadow-md active:scale-90 disabled:opacity-60"
                onClick={create}
              >
                <Plus
                  strokeWidth={2.25}
                  className="size-5 transition-transform duration-300 ease-out group-hover:rotate-90 group-active:rotate-180"
                />
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

          {failure && (
            <p className="border-y border-destructive px-5 py-2 font-mono text-[11px] text-destructive">{failure}</p>
          )}

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
        </View>

        <View shown={settingsOpen} from="right">
          <SettingsPanel />
        </View>
      </div>

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
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-pressed={settingsOpen}
            aria-label="Settings"
            title="Settings"
            className={cn(
              "grid size-6 place-items-center rounded-md border transition-all duration-300 ease-in-out active:scale-90",
              settingsOpen
                ? "scale-125 border-primary bg-accent text-primary shadow-sm"
                : "border-transparent text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Settings
              className={cn("size-3.5 transition-transform duration-500 ease-in-out", settingsOpen && "rotate-90")}
            />
          </button>
        </div>
        <ThemeToggle />
      </footer>
    </div>
  );
};

// One of the sidebar's two views. Both stay mounted (the index keeps its scroll and search) and cross-fade;
// the hidden one drifts a little to its own side and is `inert`: no focus, no clicks, not read aloud.
const View = ({ shown, from, children }: { shown: boolean; from: "left" | "right"; children: ReactNode }) => (
  <div
    inert={!shown}
    className={cn(
      "absolute inset-0 flex flex-col transition-all duration-300 ease-in-out motion-reduce:transition-none",
      shown
        ? "translate-x-0 opacity-100"
        : cn("pointer-events-none invisible opacity-0", from === "left" ? "-translate-x-3" : "translate-x-3"),
    )}
  >
    {children}
  </div>
);

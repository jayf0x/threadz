import { History, List, ListTodo, type LucideIcon, Plus, Settings, Trash2 } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SettingsPanel } from "@/features/settings";
import { TodosPanel } from "@/features/todos";
import { TrashPanel } from "@/features/trash";
import { cn } from "@/lib/cn";
import { shortcutBlocked } from "@/lib/dom";
import { errorMessage } from "@/lib/errors";
import { pickResurfacingThread } from "@/lib/resurfacing";
import type { Thread } from "@/lib/types";
import { createOrReuseThread } from "./createOrReuseThread";
import { ThreadRow } from "./ThreadRow";
import { useThreads } from "./useThreads";
import { isSort, SORTS } from "./visibleThreads";

// Rolls once per session, the moment the full thread list first arrives — not on every render, and
// not re-rolled as `threads` keeps changing underneath it (search, sync, edits). The pick then holds
// for the rest of the app's lifetime, same as opening the app once shows you one "you wrote this a
// while back" thread rather than a different one every time the list re-renders.
const useResurfacingThread = (threads: Thread[]): Thread | undefined => {
  const [picked, setPicked] = useState<Thread | undefined>(undefined);
  const rolled = useRef(false);

  useEffect(() => {
    if (rolled.current || threads.length === 0) return;
    rolled.current = true;
    setPicked(pickResurfacingThread(threads));
  }, [threads]);

  return picked;
};

// The sidebar: every thread as a row in a ledger, and the settings it flips to. Also owns the "/" and "n" shortcuts.
export const ThreadList = ({
  onOpen,
  onDeleted,
  selectedId,
}: {
  /** Open a thread — optionally jumping straight to one message in it (a todo row's click). */
  onOpen: (threadId: string, messageId?: string) => void;
  onDeleted: (id: string) => void;
  selectedId?: string | null;
}) => {
  const { threads, allThreads, query, setQuery, sort, setSort, syncing, error } = useThreads();
  const resurfaced = useResurfacingThread(allThreads);
  const [panel, setPanel] = useState<Panel>("index");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const starting = useRef(false); // "n" held down must not start a second thread before `creating` renders
  const search = useRef<HTMLInputElement>(null);

  // A thread exists the moment you ask for one, named by its number, and you land in it — no form.
  const create = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      onOpen(await createOrReuseThread());
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
      <nav className="border-b border-border">
        <SidebarSwitcher panel={panel} setPanel={setPanel} />
      </nav>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <View shown={panel === "index"} from="left">
          <header className="px-5 pb-4 pt-6">
            <h1 className="font-serif text-4xl leading-none tracking-tight">Threadz</h1>
            <Eyebrow className="mt-2">
              Index · {threads.length} thread{threads.length === 1 ? "" : "s"}
            </Eyebrow>

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
            {!query && resurfaced && (
              <li className="border-t border-rule">
                <button
                  type="button"
                  onClick={() => onOpen(resurfaced.id)}
                  className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/50"
                >
                  <History aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <Eyebrow>You wrote this a while back</Eyebrow>
                    <span className="mt-1 block truncate font-serif text-lg leading-snug">{resurfaced.title}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
          <div className="flex justify-center border-t border-border py-3">
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
        </View>

        <View shown={panel === "todos"} from="right">
          {/* `onOpen` alone: it's App.tsx's `openThreadAt`, which reflects `?thread=&msg=` into the
              URL itself now (the centralized URL-sync effect) — no separate `history.pushState`
              needed here. Staying on Todos (not switching to Index) is still this panel's own call:
              opening a thread from here shouldn't lose your place in the list — the back arrow
              (mobile) or picking another thread from Index (desktop) is how you leave it. */}
          <TodosPanel onOpenThread={onOpen} />
        </View>

        <View shown={panel === "trash"} from="right">
          {/* `onRestored` reopens the thread the same way a click on it would (App.tsx's
              `openThreadAt`) — a restore is as much "landing back in the thread" as it is
              undoing the delete. */}
          <TrashPanel onRestored={onOpen} />
        </View>

        <View shown={panel === "settings"} from="right">
          <SettingsPanel />
        </View>
      </div>
    </div>
  );
};

type Panel = "index" | "settings" | "todos" | "trash";

const PANELS: { value: Panel; label: string; icon: LucideIcon }[] = [
  { value: "index", label: "Threads", icon: List },
  { value: "todos", label: "Todos", icon: ListTodo },
  { value: "trash", label: "Recently Deleted", icon: Trash2 },
  { value: "settings", label: "Settings", icon: Settings },
];

// The sidebar's own nav — a full-width banner (mobile and desktop alike, now that the sidebar
// footer that used to hold sync/theme is gone) rather than a small centered icon pill. Each item
// gets equal width; icon only, the label is the `title` (and sr-only text).
const SidebarSwitcher = ({ panel, setPanel }: { panel: Panel; setPanel: (p: Panel) => void }) => (
  <fieldset className="flex">
    <legend className="sr-only">Sidebar view</legend>
    {PANELS.map(({ value, label, icon: Icon }) => {
      const active = panel === value;
      return (
        <label
          key={value}
          title={label}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center py-2.5 transition-colors",
            "has-focus-visible:outline has-focus-visible:outline-ring",
            active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name="sidebar-panel"
            value={value}
            checked={active}
            onChange={() => setPanel(value)}
            className="sr-only"
          />
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </label>
      );
    })}
  </fieldset>
);

// One of the sidebar's three views. All stay mounted (the index keeps its scroll and search) and cross-fade;
// a hidden one drifts a little to its own side and is `inert`: no focus, no clicks, not read aloud.
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

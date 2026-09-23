import { List, ListTodo, type LucideIcon, Plus, RefreshCw, Settings } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { StatusPill } from "@/features/connection";
import { SettingsPanel } from "@/features/settings";
import { TodosPanel } from "@/features/todos";
import { cn } from "@/lib/cn";
import { shortcutBlocked } from "@/lib/dom";
import { errorMessage } from "@/lib/errors";
import { getMode } from "@/lib/mode";
import { createOrReuseThread } from "./createOrReuseThread";
import { ThreadRow } from "./ThreadRow";
import { useThreads } from "./useThreads";
import { isSort, SORTS } from "./visibleThreads";

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
  const { threads, query, setQuery, sort, setSort, syncing, error, refresh } = useThreads();
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
      <nav className="flex items-center justify-center border-b border-border px-5 py-2.5">
        <SidebarSwitcher panel={panel} setPanel={setPanel} />
      </nav>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <View shown={panel === "index"} from="left">
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

        <View shown={panel === "todos"} from="right">
          {/* `onOpen` alone: it's App.tsx's `openThreadAt`, which reflects `?thread=&msg=` into the
              URL itself now (the centralized URL-sync effect) — no separate `history.pushState`
              needed here. Staying on Todos (not switching to Index) is still this panel's own call:
              opening a thread from here shouldn't lose your place in the list — the back arrow
              (mobile) or picking another thread from Index (desktop) is how you leave it. */}
          <TodosPanel onOpenThread={onOpen} />
        </View>

        <View shown={panel === "settings"} from="right">
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
        </div>
        <ThemeToggle />
      </footer>
    </div>
  );
};

type Panel = "index" | "settings" | "todos";

const PANELS: { value: Panel; label: string; icon: LucideIcon }[] = [
  { value: "index", label: "Threads", icon: List },
  { value: "todos", label: "Todos", icon: ListTodo },
  { value: "settings", label: "Settings", icon: Settings },
];

// The header's view switcher — same segmented-fieldset pattern as `ThemeToggle`, so the two
// three-way toggles in this sidebar (this one, and appearance in the footer) read as one family
// instead of two different button styles. Replaces the old footer icon buttons (easy to miss,
// no label until you hovered) with something that reads as navigation on sight.
const SidebarSwitcher = ({ panel, setPanel }: { panel: Panel; setPanel: (p: Panel) => void }) => (
  <fieldset className="flex gap-px border border-border p-px">
    <legend className="sr-only">Sidebar view</legend>
    {PANELS.map(({ value, label, icon: Icon }) => {
      const active = panel === value;
      return (
        <label
          key={value}
          title={label}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 px-3 py-1.5 transition-colors has-focus-visible:outline",
            "has-focus-visible:outline-ring",
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
          <Icon className="size-3.5" aria-hidden />
          <span className="text-xs">{label}</span>
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

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownUp,
  Ellipsis,
  History,
  List,
  ListTodo,
  LoaderCircle,
  type LucideIcon,
  Plus,
  Search,
  SearchX,
  Settings,
  Trash2,
  Waves,
  Waypoints,
  X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { IconSelect } from "@/components/ui/select";
import { HomePanel, type HomeTarget } from "@/features/home";
import { PoolPanel } from "@/features/pool";
import { SettingsPanel } from "@/features/settings";
import { TodosPanel } from "@/features/todos";
import { TrashPanel } from "@/features/trash";
import { cn } from "@/lib/cn";
import { isTouch, shortcutBlocked } from "@/lib/dom";
import { errorMessage } from "@/lib/errors";
import { readLastRoute, saveLastRoute } from "@/lib/lastRoute";
import { pickResurfacingThread } from "@/lib/resurfacing";
import type { Thread } from "@/lib/types";
import { createOrReuseThread } from "./createOrReuseThread";
import { ThreadRow } from "./ThreadRow";
import { useThreads } from "./useThreads";
import { isSort, SORTS } from "./visibleThreads";

// Rolls once per session, the moment the list first holds something worth resurfacing (two or more
// threads — with one, the pick would just repeat the only row) — not on every render, and not
// re-rolled as `threads` keeps changing underneath it (search, sync, edits). Only the id is kept: the
// row is looked up fresh, so a rename shows up and a deleted thread disappears instead of lingering.
const useResurfacingThread = (threads: Thread[]): Thread | undefined => {
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const rolled = useRef(false);

  useEffect(() => {
    if (rolled.current || threads.length < 2) return;
    rolled.current = true;
    setPickedId(pickResurfacingThread(threads)?.id);
  }, [threads]);

  return threads.find((t) => t.id === pickedId);
};

// The sidebar: every thread as a row in a ledger, plus the Todos/Bin/Settings views the bottom tab bar
// flips to. Also owns the "/" and "n" shortcuts.
export const ThreadList = ({
  onOpen,
  onOpenMap,
  onDeleted,
  selectedId,
}: {
  /** Open a thread — optionally jumping straight to one message in it (a todo row's click). */
  onOpen: (threadId: string, messageId?: string) => void;
  /** The computed map (`/map`) — a screen of its own, reached from here rather than a tab. */
  onOpenMap: () => void;
  onDeleted: (id: string) => void;
  selectedId?: string | null;
}) => {
  const { threads, allThreads, query, setQuery, sort, setSort, syncing, error } = useThreads();
  const resurfaced = useResurfacingThread(allThreads);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  useEffect(() => saveLastRoute({ panel }), [panel]);
  const goHome = useCallback(({ lens }: HomeTarget) => setPanel(lens), []);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const starting = useRef(false); // "n" held down must not start a second thread before `creating` renders
  const search = useRef<HTMLInputElement>(null);
  // Windowed, measured rows (the ThreadView pattern): 2k threads at the `real` seed.
  const listRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
    overscan: 10,
    getItemKey: (index) => threads[index]?.id ?? index,
  });

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
  const touch = isTouch(); // "( / )" and "press n" are keyboard hints — noise on a phone

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <View shown={panel === "index"} from="left">
          <header className="px-5 pb-3 pt-6">
            {/* The app mark is Home's only entry point (no fifth tab). */}
            <button
              type="button"
              aria-label="Home"
              title="Home"
              onClick={() => setPanel("home")}
              className="press -ml-2 flex min-h-11 items-center rounded-full px-2 md:min-h-0"
            >
              <h1 className="font-serif text-[32px] leading-none tracking-tight">Threadz</h1>
            </button>
            <Eyebrow className="mt-2">
              Index · {threads.length} thread{threads.length === 1 ? "" : "s"}
            </Eyebrow>

            <div className="mt-4 flex gap-2">
              <SearchField
                ref={search}
                value={query}
                onChange={setQuery}
                placeholder={touch ? "Search" : "Search  ( / )"}
              />
              <IconSelect
                icon={ArrowDownUp}
                aria-label="Sort threads"
                title="Sort"
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
              </IconSelect>
              {/* Pool and Map fold into one menu (docs/direction.md "Round 8"); Pool is reached from
                  here, not a fifth tab. */}
              <Menu
                align="end"
                trigger={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="More"
                    title="More"
                    className="shrink-0 rounded-full text-muted-foreground"
                  >
                    <Ellipsis aria-hidden className="size-5 md:size-4" />
                  </Button>
                }
                items={[
                  { label: "Pool", icon: Waves, onClick: () => setPanel("pool") },
                  { label: "Map", icon: Waypoints, onClick: onOpenMap },
                ]}
              />
            </div>
          </header>

          {failure && <p className="border-y border-destructive px-5 py-2 text-xs text-destructive">{failure}</p>}

          {/* `pb-24`: room for the floating New pill so it never hides the last row. */}
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-24">
            <ul style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                const t = threads[row.index];
                if (!t) return null;
                return (
                  <li
                    key={row.key}
                    data-index={row.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <div className="rise" style={{ "--i": Math.min(row.index, 14) } as CSSProperties}>
                      <ThreadRow
                        thread={t}
                        active={t.id === selectedId}
                        onClick={() => onOpen(t.id)}
                        onDeleted={onDeleted}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {threads.length === 0 && !syncing && (
              <div>{query ? <Empty icon={SearchX}>No match</Empty> : <Empty icon={List}>No threads</Empty>}</div>
            )}
            {!query && resurfaced && resurfaced.id !== selectedId && (
              <div className="border-t border-rule">
                <button
                  type="button"
                  onClick={() => onOpen(resurfaced.id)}
                  className="press-row flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left"
                >
                  <History aria-hidden className="size-5 shrink-0 text-muted-foreground md:size-4" />
                  <span className="sr-only">You wrote this a while back:</span>
                  <span className="min-w-0 truncate font-serif text-lg leading-snug">{resurfaced.title}</span>
                </button>
              </div>
            )}
          </div>
          <Button
            aria-label="New thread"
            aria-busy={creating}
            title={touch ? undefined : "New thread (n)"}
            className="absolute bottom-4 right-4 h-12 gap-1.5 pl-4 pr-5 shadow-primary/30 [--press-scale:0.94]"
            onClick={create}
          >
            {creating ? (
              <LoaderCircle aria-hidden className="size-5 animate-spin" />
            ) : (
              <Plus aria-hidden strokeWidth={2.25} className="size-5" />
            )}
            New
          </Button>
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

        <View shown={panel === "home"} from="left">
          <HomePanel onBack={() => setPanel("index")} onGo={goHome} onOpenThread={onOpen} />
        </View>

        <View shown={panel === "pool"} from="right">
          {/* Same `onOpen` reasoning as Todos/Bin above: it navigates without switching this panel
              back to Index, since sending a note here is a detour from wherever you were, not a
              return to the list. Unlike those three, Pool isn't in SidebarSwitcher's bar (it stays
              at four items per docs/direction.md "Round 6"), so it needs its own way back. */}
          <PoolPanel onBack={() => setPanel("index")} onOpenThread={onOpen} />
        </View>
      </div>
      {/* Bottom tab bar, the phone convention (and where the thumb already is). `pb-safe` clears the
          home indicator, and drops away while the keyboard is up (see lib/viewport.ts). */}
      <nav aria-label="Sections" className="pb-safe border-t border-border">
        <SidebarSwitcher panel={panel} setPanel={setPanel} />
      </nav>
    </div>
  );
};

// A pill search field: leading icon, and a 44px clear button once there is something to clear.
const SearchField = ({
  ref,
  value,
  onChange,
  placeholder,
}: {
  ref: Ref<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) => (
  <div className="relative min-w-0 flex-1">
    <Search
      aria-hidden
      className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground md:size-4"
    />
    <Input
      ref={ref}
      className="pl-11 pr-11 [&::-webkit-search-cancel-button]:appearance-none"
      type="search"
      aria-label="Search threads"
      placeholder={placeholder}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        onChange("");
        e.currentTarget.blur();
      }}
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        title="Clear"
        onClick={() => onChange("")}
        className="press-icon absolute right-0 top-0 grid size-11 place-items-center rounded-full text-muted-foreground md:size-9"
      >
        <X aria-hidden className="size-5 md:size-4" />
      </button>
    )}
  </div>
);

type Panel = "index" | "settings" | "todos" | "trash" | "pool" | "home";

const PANEL_IDS: readonly string[] = ["index", "settings", "todos", "trash", "pool", "home"];

// Reopens the panel this device left on, unless a `?thread=` deep link says where to be.
const initialPanel = (): Panel => {
  const { panel } = readLastRoute();
  const known = PANEL_IDS.find((p): p is Panel => p === panel);
  return known && !new URLSearchParams(location.search).has("thread") ? known : "index";
};

const PANELS: { value: Panel; label: string; icon: LucideIcon }[] = [
  { value: "index", label: "Threads", icon: List },
  { value: "todos", label: "Todos", icon: ListTodo },
  { value: "trash", label: "Bin", icon: Trash2 },
  { value: "settings", label: "Settings", icon: Settings },
];

// The sidebar's own nav — a full-width bottom bar (mobile and desktop alike) rather than a small centered
// icon pill. Each item gets equal width; icon only (the label is the `title` and sr-only text), the active
// one on a soft primary pill (M3-style) so the glyph stays high-contrast ink.
const SidebarSwitcher = ({ panel, setPanel }: { panel: Panel; setPanel: (p: Panel) => void }) => (
  <fieldset className="flex">
    <legend className="sr-only">Sidebar view</legend>
    {PANELS.map(({ value, label, icon: Icon }) => {
      const active = panel === value;
      return (
        <label
          key={value}
          title={label}
          className="group flex h-14 flex-1 cursor-pointer items-center justify-center md:h-12"
        >
          <input
            type="radio"
            name="sidebar-panel"
            value={value}
            checked={active}
            onChange={() => setPanel(value)}
            className="peer sr-only"
          />
          <span
            className={cn(
              "press-icon grid h-8 w-14 place-items-center rounded-full [--press-scale:0.9] md:h-7 md:w-12",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring",
              active ? "bg-primary/18 text-foreground" : "text-muted-foreground group-hover:text-foreground",
            )}
          >
            <Icon className="size-5 md:size-4" aria-hidden />
          </span>
          <span className="sr-only">{label}</span>
        </label>
      );
    })}
  </fieldset>
);

// One of the sidebar's four views. All stay mounted (the index keeps its scroll and search) and cross-fade;
// a hidden one drifts a little to its own side and is `inert`: no focus, no clicks, not read aloud.
const View = ({ shown, from, children }: { shown: boolean; from: "left" | "right"; children: ReactNode }) => (
  <div
    inert={!shown}
    className={cn(
      "absolute inset-0 flex flex-col transition-[opacity,translate,visibility] duration-[180ms] ease-out-strong motion-reduce:transition-none",
      shown
        ? "translate-x-0 opacity-100"
        : cn("pointer-events-none invisible opacity-0", from === "left" ? "-translate-x-2" : "translate-x-2"),
    )}
  >
    {children}
  </div>
);

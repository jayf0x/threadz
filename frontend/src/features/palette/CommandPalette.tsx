import * as Dialog from "@radix-ui/react-dialog";
import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { onChange } from "@/lib/changeSignal";
import { cn } from "@/lib/cn";
import { listThreads, searchThreadIds } from "@/lib/data";
import { chordBlocked } from "@/lib/dom";
import { combineScore, matchScore } from "@/lib/search";
import type { Thread } from "@/lib/types";

const NO_HITS: ReadonlyMap<string, number> = new Map();

// ⌘K/Ctrl+K, global: type to jump straight to a thread instead of navigating to the sidebar search
// first. Mounted once at App.tsx's top level (alongside ConnectionDialog) rather than inside
// ThreadList, so the shortcut works from anywhere — including while a thread is open on mobile,
// where ThreadList's own pane is off-screen — and survives the mode-keyed Shell remount. A Radix
// Dialog, not hand-rolled, per AGENTS.md's popover/menu/dialog rule; ships with Radix's instant
// open/close (no Motion) same as `Menu`. Matches the same way the sidebar search
// (`useThreads.ts`/`visibleThreads.ts`) does: instant title matching via `lib/search.ts`'s
// `matchScore` for the first keystroke, plus a ~200ms-debounced `searchThreadIds` call (full-text
// over notes, per the Lenses table) merged in with `combineScore` — title hits always outrank
// content-only ones. `visibleThreads.ts` itself isn't reused (it's `features/threads` internal, not
// exported from that feature's `index.ts`, and also carries sort/pin concerns the palette doesn't
// have); the ranking formula is mirrored here from the same exported `lib/search.ts` primitives it's
// built from.
export const CommandPalette = ({ onOpen }: { onOpen: (threadId: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kept warm the whole session (not just while open) so the first keystroke after ⌘K has
  // something to match against instantly — same `getThreads` + `onChange` pairing `useThreads` uses.
  useEffect(() => {
    const load = () => listThreads().then(setThreads, () => {});
    load();
    return onChange(load);
  }, []);

  // Content (note-text) hits for the current query, debounced the same ~200ms `useThreads.ts` uses.
  const [content, setContent] = useState<{ q: string; ranks: ReadonlyMap<string, number> }>({
    q: "",
    ranks: NO_HITS,
  });
  const contentHits = content.q === query.trim() ? content.ranks : NO_HITS;

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(() => {
      searchThreadIds(q).then(
        (ids) => !stale && setContent({ q, ranks: new Map(ids.map((id, i) => [id, i])) }),
        () => {},
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "k" || chordBlocked()) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlighted(0);
  }, [open]);

  // Same combine-and-rank as `visibleThreads.ts`: a title match (via `matchScore`) always outranks
  // a content-only hit; within a bucket, `combineScore` breaks ties by exact-match strength / rank
  // position. Unlike the sidebar list, there's no `sort`/pinned fallback here — an empty query is
  // just recency, same as before.
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
    return threads
      .map((t) => {
        const rank = contentHits.get(t.id);
        return { t, score: combineScore(matchScore(t.title, q), rank == null ? null : -rank) };
      })
      .filter((r): r is { t: Thread; score: number } => r.score != null)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.t)
      .slice(0, 50);
  }, [threads, query, contentHits]);

  const pick = (t: Thread) => {
    onOpen(t.id);
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        {/* Opened by a keyboard chord, so no enter animation. `top` follows the visual viewport (iOS pans it). */}
        <Dialog.Content className="surface-float fixed left-1/2 top-[calc(var(--vv-top,0px)+0.75rem)] z-50 flex max-h-[calc(var(--vv-h,100dvh)-1.5rem)] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl shadow-xl outline-none ring-1 ring-border md:top-[20vh] md:max-h-[60vh]">
          <Dialog.Title className="sr-only">Jump to thread</Dialog.Title>
          <Dialog.Description className="sr-only">Type to search threads by title or content.</Dialog.Description>
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <Search className="size-5 shrink-0 text-muted-foreground md:size-4" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlighted((h) => Math.min(h + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlighted((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const t = results[highlighted];
                  if (t) pick(t);
                }
              }}
              placeholder="Search"
              aria-label="Jump to a thread"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:h-6 md:text-sm"
            />
            <Eyebrow className="shrink-0 pointer-coarse:hidden">esc</Eyebrow>
          </div>
          <ul className="min-h-0 overflow-y-auto p-1.5">
            {results.length === 0 && (
              <li className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <SearchX aria-hidden className="size-5 md:size-4" /> No match
              </li>
            )}
            {results.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => pick(t)}
                  className={cn(
                    "press-row block h-12 w-full truncate rounded-xl px-3 text-left text-base outline-none md:h-9 md:text-sm",
                    i === highlighted && "bg-accent",
                  )}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

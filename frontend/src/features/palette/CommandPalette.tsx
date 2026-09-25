import * as Dialog from "@radix-ui/react-dialog";
import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { getThreads } from "@/lib/db";
import { chordBlocked } from "@/lib/dom";
import { matchScore } from "@/lib/search";
import { onChange } from "@/lib/sync";
import type { Thread } from "@/lib/types";

// ⌘K/Ctrl+K, global: type to jump straight to a thread instead of navigating to the sidebar search
// first. Mounted once at App.tsx's top level (alongside ConnectionDialog) rather than inside
// ThreadList, so the shortcut works from anywhere — including while a thread is open on mobile,
// where ThreadList's own pane is off-screen — and survives the mode-keyed Shell remount. A Radix
// Dialog, not hand-rolled, per AGENTS.md's popover/menu/dialog rule; ships with Radix's instant
// open/close (no Motion) same as `Menu`. Matching reuses `lib/search.ts`'s `matchScore` — the same
// typo-tolerant scorer `visibleThreads.ts` already uses — against title only (no note text: that
// needs an API round-trip, more than a quick switcher needs).
export const CommandPalette = ({ onOpen }: { onOpen: (threadId: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kept warm the whole session (not just while open) so the first keystroke after ⌘K has
  // something to match against instantly — same `getThreads` + `onChange` pairing `useThreads` uses.
  useEffect(() => {
    const load = () => getThreads().then(setThreads, () => {});
    load();
    return onChange(load);
  }, []);

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

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
    return threads
      .map((t) => ({ t, score: matchScore(t.title, q) }))
      .filter((r): r is { t: Thread; score: number } => r.score != null)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.t)
      .slice(0, 50);
  }, [threads, query]);

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
          <Dialog.Description className="sr-only">Type to fuzzy-match a thread by title.</Dialog.Description>
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

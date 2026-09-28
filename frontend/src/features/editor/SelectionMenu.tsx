import * as Popover from "@radix-ui/react-popover";
import { Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { allMessages } from "@/lib/data";
import { messageSnippet, searchMessages, searchThreads } from "@/lib/references";
import type { Message, Thread } from "@/lib/types";
import { keyboardInset } from "./ReferenceAutocompleteMenu";

// Where the picker is in its own little flow: "trigger" is the floating "Link" pill a text
// selection shows; "thread" and "message" are the same two-stage local search the `[[` autocomplete
// offers (lib/references.ts's searchThreads/searchMessages), just driven by a search box here
// instead of by what's typed in the document (a selection's own text never doubles as the query).
type Stage =
  | { stage: "trigger" }
  | { stage: "thread"; query: string }
  | { stage: "message"; threadId: string; query: string };

export type SelectionMenuProps = {
  /** Viewport-relative, from `selectionPlugin.ts`'s `coordsAtPos`. `null` = closed (no selection). */
  rect: { left: number; top: number; bottom: number } | null;
  /** A target was picked: a thread (bare `messageId: null`) or one specific message inside it. */
  onPick: (threadId: string, messageId: string | null) => void;
  /** Only ever called with `false`, from Radix's own outside-click detection — same contract as
   * `ReferenceAutocompleteMenu`. */
  onOpenChange: (open: boolean) => void;
};

// The selection→link flow (AGENTS.md "Making connections with one thumb: select text or long-press
// → menu"): select text inside an editable field, tap the floating "Link" trigger it shows, then
// pick a thread (and, optionally, a specific message inside it) the same local-only way the `[[`
// autocomplete does. Anchored exactly like `ReferenceAutocompleteMenu` — a synthetic Popover.Anchor
// at the selection's rect, since there's no real DOM element sitting "at the selection" the way a
// menu trigger normally has one. `MarkdownEditor` owns turning the pick into the actual doc edit
// (`completeReference`, reused as-is from the `[[` flow) and reporting it up for the caller to
// materialize as a real `links` row (`lib/data.ts`'s `createLink`) — this component only picks a
// target, it never touches the document or the database itself.
export const SelectionMenu = ({ rect, onPick, onOpenChange }: SelectionMenuProps) => {
  const [state, setState] = useState<Stage>({ stage: "trigger" });
  const [snapshot, setSnapshot] = useState<{ threads: Thread[]; messages: Message[] } | null>(null);

  // A fresh selection always starts back at the trigger, never mid-picker from a previous selection.
  useEffect(() => {
    if (!rect) setState({ stage: "trigger" });
  }, [rect]);

  // Loaded once the picker actually opens (not on every keystroke) — same "cheap read, no reason to
  // repeat it while just narrowing a query" reasoning as `useReferenceAutocomplete.ts`.
  useEffect(() => {
    if (state.stage === "trigger") return;
    let cancelled = false;
    allMessages().then((snap) => {
      if (!cancelled) setSnapshot(snap);
    });
    return () => {
      cancelled = true;
    };
  }, [state.stage]);

  if (!rect) return null;
  const inset = keyboardInset();

  const item = (key: string, label: string, onSelect: () => void) => (
    <button
      key={key}
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // keep focus in the text field, not on this button
        onSelect();
      }}
      className="press-row flex h-11 w-full items-center rounded-xl px-3 text-left text-base outline-none hover:bg-accent/60 md:text-sm"
    >
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <Popover.Root open onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            width: 1,
            height: Math.max(1, rect.bottom - rect.top),
            pointerEvents: "none",
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={{ top: 12 + inset.top, bottom: 12 + inset.bottom, left: 12, right: 12 }}
          onOpenAutoFocus={(e) => {
            if (state.stage === "trigger") e.preventDefault();
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "pop-in z-50 overflow-y-auto rounded-2xl bg-card/95 shadow-lg ring-1 ring-border outline-none backdrop-blur-xl",
            state.stage === "trigger"
              ? "p-1"
              : "flex w-72 max-w-[min(20rem,var(--radix-popover-content-available-width))] max-h-[min(18rem,var(--radix-popover-content-available-height))] flex-col gap-1.5 p-1.5",
          )}
        >
          {state.stage === "trigger" && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the text field, not on this button
                setState({ stage: "thread", query: "" });
              }}
              className="press-row flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm outline-none hover:bg-accent/60"
            >
              <LinkIcon className="size-4 shrink-0" />
              Link
            </button>
          )}
          {state.stage !== "trigger" && (
            <>
              <Input
                autoFocus
                aria-label={state.stage === "thread" ? "Search threads" : "Search messages"}
                placeholder={state.stage === "thread" ? "Search threads…" : "Search messages…"}
                value={state.query}
                onChange={(e) => setState((s) => (s.stage === "trigger" ? s : { ...s, query: e.target.value }))}
                className="h-9 shrink-0"
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {!snapshot ? (
                  <p className="flex h-11 items-center px-3 text-sm text-muted-foreground">Loading…</p>
                ) : state.stage === "thread" ? (
                  searchThreads(snapshot.threads, state.query).length === 0 ? (
                    <p className="flex h-11 items-center px-3 text-sm text-muted-foreground">No match</p>
                  ) : (
                    searchThreads(snapshot.threads, state.query).map((t) =>
                      item(t.id, t.title, () => setState({ stage: "message", threadId: t.id, query: "" })),
                    )
                  )
                ) : (
                  <>
                    {item("__thread__", "Link to whole thread", () => onPick(state.threadId, null))}
                    {searchMessages(snapshot.messages, state.threadId, state.query).map((m) =>
                      item(m.id, messageSnippet(m.content) || "(empty)", () => onPick(state.threadId, m.id)),
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

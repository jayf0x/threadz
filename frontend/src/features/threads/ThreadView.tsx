import * as Popover from "@radix-ui/react-popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import {
  ArrowDownUp,
  ArrowLeft,
  Check,
  CloudOff,
  Copy,
  GitBranchPlus,
  Link,
  Mic,
  MoreHorizontal,
  Pencil,
  Square,
  SquareCheck,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, m as Motion, useReducedMotion } from "motion/react";
import { type CSSProperties, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Menu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { Composer } from "@/features/composer";
import { ImageButton, MarkdownEditor, type MarkdownEditorHandle, useImageAttach } from "@/features/editor";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getThreadLocal } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { buildReferenceHref, messageSnippet, resolveMessageRange } from "@/lib/references";
import { useStatus } from "@/lib/status";
import { onChange, pullThreads } from "@/lib/sync";
import { orderMessages, setThreadReversed, useThreadReversed } from "@/lib/threadOrder";
import { toggleTodoLine } from "@/lib/todos";
import type { Annotation, Message, Thread } from "@/lib/types";
import { ROW_SELECT_IGNORE, shouldSelectRow } from "./rowSelect";
import { useThread } from "./useThread";

export const ThreadView = ({
  threadId,
  onBack,
  onCopied,
  autofocus,
  selectedMessageId,
  onSelectMessage,
  pulseMessageId,
  onNavigateReference,
}: {
  threadId: string;
  onBack: () => void;
  onCopied: (newThreadId: string) => void; // open the copy once it exists
  /** Land straight in a focused composer (a `/capture` deep link into a fresh thread). */
  autofocus?: boolean;
  /** The thread's persistently-selected message, if any (controlled — owned by App.tsx right
   * alongside the open thread itself, mirrored in `?msg=`). Clicking a row selects it; clicking the
   * selected row again, or a different row, changes/clears it via `onSelectMessage` below. */
  selectedMessageId: string | null;
  /** A plain in-thread click reporting the new selection (or `null` to clear it) — never called for
   * navigational arrivals (see `pulseMessageId`), which App.tsx already reflects into
   * `selectedMessageId` itself. */
  onSelectMessage: (id: string | null) => void;
  /** A todo jump or `?thread=&msg=` deep link *arriving* at a message: scroll it into view and pulse
   * it once. Always one of the messages `selectedMessageId` already names — this only adds the
   * one-shot "you just got here" motion on top of the (already-persistent) selected look; a plain
   * click that changes `selectedMessageId` does not pulse, it's already on screen. */
  pulseMessageId?: string;
  /** A completed reference (`lib/references.ts`) was clicked in a message, a note, an edit
   * history entry, or a scratch answer: App.tsx's `openThreadAt` — the same deep-link machinery a
   * todo row's click or a `?thread=&msg=` URL already goes through, never a page reload. */
  onNavigateReference: (threadId: string, messageId?: string) => void;
}) => {
  const {
    messages,
    annotations,
    unsynced,
    unsyncedAnnotations,
    busy,
    error,
    gone,
    justAdded,
    addMessage,
    editMessage,
    setMessageTodo,
    addAnnotation,
    editAnnotation,
    deleteAnnotation,
    ask,
  } = useThread(threadId);
  const local = useStatus().mode === "local";
  const reversed = useThreadReversed(threadId); // device-local, per-thread: newest at top instead of bottom
  const [thread, setThread] = useState<Thread | null>(null);
  const [vanished, setVanished] = useState(false); // was in the mirror, then a list refresh dropped it
  const [scratch, setScratch] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The composer sits at the end of the scroller. Focused (keyboard up) it sticks to the bottom of the
  // visible area while the messages scroll under it; unfocused it scrolls away with them (desktop
  // always pins it — see the wrapper below). `:focus-within` decides, not React state: a focused
  // Send button that turns `disabled` after sending loses focus without any blur event, which left
  // state-driven pinning stuck on.
  const composerRef = useRef<HTMLDivElement>(null);
  const [pulsingIds, setPulsingIds] = useState<string[]>([]); // arrival-only animation, self-clears
  const scrolledTo = useRef<string | undefined>(undefined); // don't re-jump once this target's been reached
  const arrival = useRef<ReturnType<typeof setTimeout>[]>([]); // the arrival jump's follow-up timers
  const following = useRef(true); // scrolled to the newest end: keep it there while rows are still being measured
  // An empty mirror means "still loading", not "deleted": only the store's own 404 (`gone`), or a thread
  // we had displayed disappearing from a refreshed mirror, says the thread is really gone.
  const missing = gone || vanished;

  // `messages` stays chronological (oldest→newest) — it's what Composer's "copy from here" and the
  // autoscroll-to-newest logic below need. Rendering order is a separate, derived concern: every
  // consumer that cares where a message sits on screen (the virtualizer, the render loop's index
  // lookup, jump-to-message) reads `orderedMessages` instead, so the flip can't desync one from another.
  const orderedMessages = useMemo(() => orderMessages(messages, reversed), [messages, reversed]);
  // `selectedMessageId` (and `pulseMessageId`) may name a range (`from..to`, a reference link's
  // `message=<from>..<to>`), not just one message — every row in it looks selected.
  const selectedIds = useMemo(
    () => new Set(resolveMessageRange(orderedMessages, selectedMessageId).map((m) => m.id)),
    [orderedMessages, selectedMessageId],
  );

  // Windowed rendering: a long-lived thread can reach hundreds of entries, each its own
  // MarkdownEditor (a lazy Milkdown/ProseMirror mount) — cheap to scroll past, not cheap to all
  // exist at once. `estimateSize` is a rough starting guess (most entries are a line or two);
  // `measureElement` (wired on each row below) corrects it against the real rendered height as
  // rows come into view, including a later resize (opening edit mode, an image loading in).
  const rowVirtualizer = useVirtualizer({
    count: orderedMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 8,
    getItemKey: (index) => orderedMessages[index]?.id ?? index,
  });

  // One note per message (DB-enforced), so this is a plain lookup, not a grouped list.
  const noteByMessage = useMemo(() => new Map(annotations.map((a) => [a.messageId, a])), [annotations]);

  // "Clone from here": B is A up to and including this message. A is never touched.
  const copyThreadFrom = async (uptoMessageId: string) => {
    if (copying) return;
    setCopying(true);
    try {
      const { thread: copy } = await api.copyThread(threadId, { newThreadId: crypto.randomUUID(), uptoMessageId });
      await pullThreads();
      onCopied(copy.id);
    } catch (e) {
      toast({ title: "Clone failed", description: errorMessage(e) }); // nothing was touched
    } finally {
      setCopying(false);
    }
  };

  const onAsk = async (prompt: string, commit: boolean) => {
    setScratch(null);
    try {
      const answer = await ask(prompt, commit);
      if (!commit) setScratch(answer);
      return true;
    } catch {
      return false; // useThread already surfaced the error
    }
  };

  // The title can change from the sidebar (rename) or from a pull.
  useEffect(() => {
    let seen = false;
    const load = () =>
      getThreadLocal(threadId).then((t) => {
        seen ||= !!t;
        setThread(t ?? null);
        setVanished(seen && !t);
      });
    load();
    return onChange(load);
  }, [threadId]);

  // A log reads top-down and you write at the bottom: follow the newest entry — unless a jump to a
  // specific message (below) is pending, which wins. The scratch answer always renders after the
  // list, right above the composer, regardless of order, so it always means "scroll to the end";
  // a genuinely new message means "scroll to wherever newest now sits" — index 0 when reversed,
  // the end otherwise. The end is reached by setting the list's own `scrollTop`, never
  // `scrollIntoView`: that scrolls every scrollable ancestor too, including iOS's visual viewport,
  // which is what shoved the whole layout around while the keyboard was opening.
  useEffect(() => {
    if (pulseMessageId) return;
    if (!scratch && reversed && orderedMessages.length) rowVirtualizer.scrollToIndex(0, { align: "start" });
    else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    following.current = true;
  }, [orderedMessages.length, scratch, pulseMessageId, reversed, rowVirtualizer]);

  // Rows are only measured once they render, so the list keeps growing (or briefly collapses) after the
  // scroll above ran against estimates — opening a thread landed at its top, a new note left the
  // composer half cut off. While still following the newest end, re-pin whenever the height settles.
  const totalSize = rowVirtualizer.getTotalSize();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `totalSize` is the trigger, not a value read inside
  useEffect(() => {
    if (pulseMessageId || reversed || !following.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [totalSize, pulseMessageId, reversed]);

  // Jump to a specific message (a todo row's click, or a `?thread=&msg=` deep link): scroll the
  // virtualizer to its index once it's actually in `orderedMessages` — a fresh mount's history load
  // can resolve after this prop is already set, so this keeps re-checking on every update instead of
  // scrolling once to an index that isn't there yet. Indexing into `orderedMessages` (not `messages`)
  // means this keeps landing on the right row whichever way the thread is currently sorted.
  // `scrolledTo` guards against re-jumping (and re-pulsing) on every later message list update once
  // the target's been hit — `selectedMessageId` itself (below) is what actually keeps the row looking
  // selected; this effect only ever adds the one-shot arrival motion on top of it.
  useEffect(() => {
    if (!pulseMessageId || scrolledTo.current === pulseMessageId) return;
    const range = resolveMessageRange(orderedMessages, pulseMessageId); // display order: [0] is the topmost row
    const first = range[0];
    if (!first) return;
    scrolledTo.current = pulseMessageId;
    const index = orderedMessages.findIndex((m) => m.id === first.id);
    const align = range.length > 1 ? "start" : "center";
    rowVirtualizer.scrollToIndex(index, { align });
    setPulsingIds(range.map((m) => m.id));
    // One-shot timers, cleared on unmount only (not on this effect's re-runs: the guard above means
    // a re-run does nothing, and its cleanup would cancel the pulse's end). Rows are still growing as
    // their lazy editors mount (a first paint is shorter than the settled row), so the offset
    // computed now lands short: re-aim a few times.
    arrival.current = [
      setTimeout(() => setPulsingIds([]), 1600),
      ...[300, 900, 1800].map((ms) => setTimeout(() => rowVirtualizer.scrollToIndex(index, { align }), ms)),
    ];
  }, [pulseMessageId, orderedMessages, rowVirtualizer]);
  useEffect(() => () => arrival.current.forEach(clearTimeout), []);

  // Clicks that land outside the thing they'd act on: anywhere but the composer lets go of it (iOS
  // doesn't close the keyboard for a tap on plain content, and while the composer is focused it stays
  // pinned instead of scrolling with the messages), and anywhere but a message clears the selection —
  // after a todo jump the target stays selected, and this is the way to let go of it. Menus and
  // popovers render in portals but still bubble React events up through their row/composer, so they're
  // matched by Radix's wrapper attribute rather than by DOM containment.
  const onBackgroundClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (composerRef.current?.contains(document.activeElement) && !target.closest(`[data-composer], ${PORTAL}`))
      (document.activeElement as HTMLElement | null)?.blur();
    if (selectedMessageId && !target.closest(`article, ${PORTAL}`)) onSelectMessage(null);
  };

  if (missing) return <NotFound onBack={onBack} />;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a background click only clears the selection; every action has its own control
    // biome-ignore lint/a11y/useKeyWithClickEvents: same — nothing here is keyboard-reachable only through this handler
    <div className="surface-background flex h-full flex-col" onClick={onBackgroundClick}>
      {/* A breadcrumb on a phone (back arrow + small title, one compact row) — the sidebar is
          hidden while a thread is open there, so this is the only way back, not a place for a
          full editorial heading. `lg:` gets the roomier one back: the sidebar is already visible
          beside it, so the title can afford to be a real heading. */}
      <header className="border-b border-border">
        {/* Padding lives inside the `max-w-3xl` box (like the message column and composer below), so the
            title starts at the same x as the messages instead of 40px left of them. */}
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2 md:px-10 lg:gap-2 lg:py-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to index"
            className="shrink-0 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1
            title={thread?.title}
            className="min-w-0 truncate text-sm font-medium lg:font-serif lg:text-2xl lg:font-normal lg:leading-tight lg:tracking-tight"
          >
            {thread?.title ?? "…"}
          </h1>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto shrink-0"
            aria-label={
              reversed
                ? "Showing newest first — switch to oldest first"
                : "Showing oldest first — switch to newest first"
            }
            title={reversed ? "Newest first" : "Oldest first"}
            aria-pressed={reversed}
            onClick={() => setThreadReversed(threadId, !reversed)}
          >
            <ArrowDownUp className="size-4" />
          </Button>
        </div>
      </header>

      {error && (
        <p className="border-b border-destructive px-6 py-2 font-mono text-[11px] text-destructive md:px-10">{error}</p>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
        }}
      >
        <div className="flex min-h-full flex-col">
          <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-6 md:px-10">
            {messages.length === 0 && !scratch && (
              <p className="py-16 font-serif text-lg italic text-muted-foreground">
                Blank page. Write the first line below.
              </p>
            )}

            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                const m = orderedMessages[row.index];
                if (!m) return null;
                return (
                  <div
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
                    <EntryRow
                      message={m}
                      pending={unsynced.has(m.id)}
                      busy={busy}
                      isNew={justAdded.has(m.id)}
                      selected={selectedIds.has(m.id)}
                      pulsing={pulsingIds.includes(m.id)}
                      onSelect={() => onSelectMessage(selectedMessageId === m.id ? null : m.id)}
                      onEdit={(text) => editMessage(m.id, text)}
                      onCopyThread={() => copyThreadFrom(m.id)}
                      onSetTodo={(done) => setMessageTodo(m.id, done)}
                      note={noteByMessage.get(m.id)}
                      unsyncedAnnotations={unsyncedAnnotations}
                      onAddAnnotation={(text) => addAnnotation(m.id, text)}
                      onEditAnnotation={editAnnotation}
                      onDeleteAnnotation={deleteAnnotation}
                      onNavigateReference={onNavigateReference}
                    />
                  </div>
                );
              })}
            </div>

            <AnimatePresence>
              {scratch && (
                <Motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="mt-4 border border-dashed border-border p-4"
                >
                  <Eyebrow className="flex items-center justify-between">
                    Scratch — not saved
                    <button type="button" aria-label="Dismiss scratch answer" onClick={() => setScratch(null)}>
                      <X className="size-3.5" />
                    </button>
                  </Eyebrow>
                  <MarkdownEditor
                    readOnly
                    value={scratch}
                    className="[--md-padding:0.5rem_0_0]"
                    onReferenceClick={(threadId, messageId) => onNavigateReference(threadId, messageId ?? undefined)}
                  />
                </Motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* `bg-background` under the (translucent) composer only once it can overlap messages. */}
          <div
            ref={composerRef}
            data-composer=""
            className="mt-auto focus-within:sticky focus-within:bottom-0 focus-within:z-10 focus-within:bg-background md:sticky md:bottom-0 md:z-10 md:bg-background"
          >
            <Composer
              threadId={threadId}
              messages={messages}
              busy={busy}
              canAsk={!local}
              onNote={addMessage}
              onAsk={onAsk}
              onCopied={onCopied}
              autofocus={autofocus}
              onNavigateReference={onNavigateReference}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const NotFound = ({ onBack }: { onBack: () => void }) => (
  <div className="h-full px-6 py-16 md:px-10">
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl leading-tight tracking-tight">Thread not found</h1>
      <p className="mt-2 font-serif text-lg italic text-muted-foreground">
        It was deleted on another device, or isn't in this copy yet.
      </p>
      <Button size="sm" variant="ghost" className="-ml-2 mt-4" onClick={onBack}>
        <ArrowLeft className="size-3.5" /> Back to the index
      </Button>
    </div>
  </div>
);

const PORTAL = "[data-radix-popper-content-wrapper]";
const FOLLOW_SLACK_PX = 96; // closer than this to the bottom still counts as "at the newest entry"
const tiny = "font-mono text-[10px] text-muted-foreground";
// Icon-button hit area: 40px on a phone, the old compact 24px from `md` up.
const tap = "flex items-center justify-center p-2.5 transition-colors md:p-1";

// Edit box starts close to the size of the text it's replacing, not a fixed one-size box that's
// too cramped for a long note and too roomy for a one-liner — floor so a short message still gets
// a comfortable box, ceiling matching the editor's own 60%-of-visible-height scroll cap so a giant message
// doesn't measure into an edit box taller than the thread pane itself.
const EDIT_MIN_PX = 96;
const EDIT_MAX_RATIO = 0.6;
const RAW_HEADROOM = 1.25;
const EDIT_PAD_PX = 20; // the edit box's own vertical padding (`--md-padding`: 10px top + bottom)

// One entry: the content, and — only while it is the selected message — a hairline of tiny metadata and the
// ⋯ menu under it. Your notes can be edited in place (the previous text is kept and can be shown under
// "edited"). A note (annotation) is a quiet aside attached to the entry, not another entry: a small icon
// (present only once there is a note; "Add note" lives in the ⋯ menu) that opens it in a popover instead of
// pushing the thread's own layout around — reading down a long thread never loses its place to an expanding
// neighbour.
export const EntryRow = ({
  message: m,
  pending,
  busy,
  isNew,
  selected,
  pulsing,
  onSelect,
  onEdit,
  onCopyThread,
  onSetTodo,
  note,
  unsyncedAnnotations,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onNavigateReference,
}: {
  message: Message;
  pending: boolean;
  busy: boolean;
  isNew: boolean; // appended (or synced in) during this session — vs. part of the history load
  selected: boolean; // this thread's persistently-selected message (`?msg=`) — until deselected, not a flash
  pulsing: boolean; // landed on via a todo jump or `?thread=&msg=` link *this render* — brief arrival pulse on top of `selected`
  onSelect: () => void; // row clicked: select it, or clear if it's already selected (toggle lives in the caller)
  onEdit: (text: string) => Promise<boolean>;
  onCopyThread: () => void;
  onSetTodo: (done: boolean | null) => void; // ⋯ menu's Todo toggle; null clears the flag
  note: Annotation | undefined; // one per message, DB-enforced
  unsyncedAnnotations: Set<string>;
  onAddAnnotation: (text: string) => Promise<boolean>;
  onEditAnnotation: (id: string, text: string) => Promise<boolean>;
  onDeleteAnnotation: (id: string) => Promise<boolean>;
  onNavigateReference: (threadId: string, messageId?: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [editMinHeight, setEditMinHeight] = useState(EDIT_MIN_PX);
  const [history, setHistory] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false); // editing existing note text, vs. its read view
  const [noteText, setNoteText] = useState(note?.content ?? "");
  const editor = useRef<MarkdownEditorHandle>(null);
  const noteEditor = useRef<MarkdownEditorHandle>(null);
  const openNoteAfterMenu = useRef(false); // set by the menu's "Add note", consumed when the menu finishes closing
  const reduceMotion = useReducedMotion();
  const { attach, error: imageError } = useImageAttach(editor);
  const { attach: noteAttach, error: noteImageError } = useImageAttach(noteEditor);
  const mine = m.role === "user";
  const navigateReference = (threadId: string, messageId: string | null) =>
    onNavigateReference(threadId, messageId ?? undefined);
  const changed = text.trim() && text.trim() !== m.content;
  const composingNote = noteEditing || !note; // nothing to view yet, or editing what's there
  const noteSaveDisabled = busy || !noteText.trim() || (!!note && noteText.trim() === note.content);

  // Ready to paste straight into another note — same `[text](thread=…?message=…)` shape the
  // autocomplete itself produces (lib/references.ts), not a bare URL.
  const copyLink = async () => {
    const linkText = messageSnippet(m.content) || "message";
    try {
      await navigator.clipboard.writeText(`[${linkText}](${buildReferenceHref(m.threadId, m.id)})`);
      toast({ title: "Link copied" });
    } catch (e) {
      toast({ title: "Copy failed", description: errorMessage(e) });
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(m.content);
      toast({ title: "Copied" });
    } catch (e) {
      toast({ title: "Copy failed", description: errorMessage(e) });
    }
  };

  const save = async () => {
    const next = (editor.current?.getMarkdown() ?? text).trim(); // `text` lags typing by the debounce
    if (next && next !== m.content && (await onEdit(next))) setEditing(false);
  };
  const startEdit = () => {
    setText(m.content);
    // The raw-markdown box is monospace and padded: the same text wraps onto more lines than the
    // rendered read view measured here, so it needs headroom or its last line starts out clipped.
    const measured = (contentRef.current?.getBoundingClientRect().height ?? 0) * RAW_HEADROOM + EDIT_PAD_PX;
    setEditMinHeight(
      Math.min(Math.max(measured, EDIT_MIN_PX), (window.visualViewport?.height ?? window.innerHeight) * EDIT_MAX_RATIO),
    );
    setEditing(true);
  };

  // Reopening (or closing) an existing note always lands on its quiet read view, not wherever
  // editing was left — composing a brand-new note keeps whatever was typed.
  const onNoteOpenChange = (open: boolean) => {
    setNoteOpen(open);
    if (open && note) setNoteEditing(false);
  };
  const startNoteEdit = () => {
    if (!note) return;
    setNoteText(note.content);
    setNoteEditing(true);
  };
  const cancelNoteEdit = () => {
    setNoteText(note?.content ?? "");
    if (note) setNoteEditing(false);
    else setNoteOpen(false); // nothing to fall back to — just collapse
  };
  const saveNote = async () => {
    const next = (noteEditor.current?.getMarkdown() ?? noteText).trim();
    if (!next) return;
    if (note) {
      if (next !== note.content && (await onEditAnnotation(note.id, next))) setNoteEditing(false);
    } else if (await onAddAnnotation(next)) {
      setNoteText("");
    }
  };
  const deleteNote = async () => {
    if (!note || !confirm("Delete this note? This cannot be undone.")) return;
    if (await onDeleteAnnotation(note.id)) {
      setNoteOpen(false);
      setNoteText(""); // otherwise reopening (now with no note) would pre-fill the just-deleted text
    }
  };

  return (
    <Motion.article
      className={cn(
        "group relative border-b border-rule py-4",
        !editing && "cursor-pointer hover:bg-accent/50",
        selected && "message-selected",
        pulsing && "message-pulse",
      )}
      // Row-select: click anywhere in the row selects it (toggling off on a re-click of the same
      // row is the caller's job — see `onSelect`), except the ⋯ menu, the note trigger, and the
      // "edited" toggle (all wrapped in one `data-row-select-ignore` zone, see rowSelect.ts) and
      // anything in edit mode, where this is a live editor instead of a message to select.
      onClick={(e) => {
        if (shouldSelectRow(e.target as Element, editing)) onSelect();
      }}
      // `initial={false}` starts a history-loaded row already in its resting state — only a
      // message that showed up after the fact (a note you just added, one that synced in) gets
      // the little rise-in; a long thread's first render never animates.
      initial={isNew && !reduceMotion ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {!mine && <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-primary">Claude</p>}

      {editing ? (
        <>
          <div className="relative">
            <MarkdownEditor
              handleRef={editor}
              value={text}
              onChange={setText}
              readOnly={busy}
              autofocus
              onImageFile={(f) => attach([f])}
              className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-max-height:calc(var(--vv-h,100dvh)*0.6)] [--md-padding:10px_44px_10px_12px]"
              style={{ "--md-min-height": `${editMinHeight}px` } as CSSProperties}
              onKeyDownCapture={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  save();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
            <ImageButton onFiles={attach} disabled={busy} className="absolute right-1 top-1" />
          </div>
          {imageError && <p className="mt-1 truncate font-mono text-[11px] text-destructive">{imageError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !changed} onClick={save}>
              Save
            </Button>
          </div>
        </>
      ) : (
        <div ref={contentRef}>
          <MarkdownEditor
            readOnly
            value={m.content}
            className="[--md-padding:0]"
            onTodoToggle={(lineIndex) => onEdit(toggleTodoLine(m.content, lineIndex))}
            onReferenceClick={navigateReference}
          />
        </div>
      )}

      {/* The gutter: a per-message left rail, one consistent x for every icon in it —
          `left-[-22px]` puts the icon's glyph at the same x=-20px `todoDecoration.ts`'s checkbox
          widget uses (via `.threadz-todo-checkbox` in markdown-editor.css). Both read off the same
          x=0: this `<article>` has no left padding of its own, and neither does `contentRef`'s
          `.threadz-md`/`.ProseMirror` (`--md-padding:0` above) or a `/todo` paragraph/`/todos`
          item's `<li>`. Fixed at `top-5` (20px): roughly the first line's vertical centre — a static
          number, not measured, same "no DOM measurement" mechanism as the checkbox itself. Only for
          `mine` (a note is only ever added to your own entries) and only outside edit mode.
          The icon exists only while there IS a note (a note-less message shows nothing here — "Add
          note" is in its ⋯ menu); the `Anchor` is always there so the popover has somewhere to open
          from either way. */}
      {!editing && mine && (
        <Popover.Root open={noteOpen} onOpenChange={onNoteOpenChange}>
          <Popover.Anchor asChild>
            <span aria-hidden className="pointer-events-none absolute left-[-20px] top-5 size-4" />
          </Popover.Anchor>
          {note && (
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Note"
                title="Note"
                {...{ [ROW_SELECT_IGNORE]: "" }}
                className="absolute left-[-22px] top-[18px] p-1 text-primary/70 transition-colors hover:text-primary"
              >
                <StickyNote className="size-4" />
              </button>
            </Popover.Trigger>
          )}
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={8}
              className="z-50 w-80 max-w-[min(20rem,var(--radix-popover-content-available-width))] rounded-md border border-border bg-card/90 p-3 shadow-lg outline-none backdrop-blur-md"
            >
              {composingNote ? (
                <>
                  <div className="relative">
                    <MarkdownEditor
                      handleRef={noteEditor}
                      value={noteText}
                      onChange={setNoteText}
                      readOnly={busy}
                      autofocus
                      placeholder="A quick note…"
                      onImageFile={(f) => noteAttach([f])}
                      className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-min-height:3rem] [--md-max-height:12rem] [--md-padding:8px_44px_8px_10px]"
                      onKeyDownCapture={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          e.stopPropagation();
                          saveNote();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          cancelNoteEdit();
                        }
                      }}
                    />
                    <ImageButton onFiles={noteAttach} disabled={busy} className="absolute right-1 top-1" />
                  </div>
                  {noteImageError && (
                    <p className="mt-1 truncate font-mono text-[11px] text-destructive">{noteImageError}</p>
                  )}
                  <div className="mt-1.5 flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label="Cancel"
                      title="Cancel"
                      onClick={cancelNoteEdit}
                      className={cn(tap, "text-muted-foreground hover:text-foreground")}
                    >
                      <X className="size-4 md:size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Save note"
                      title="Save note"
                      disabled={noteSaveDisabled}
                      onClick={saveNote}
                      className={cn(
                        tap,
                        "text-primary hover:text-primary/80 disabled:pointer-events-none disabled:opacity-40",
                      )}
                    >
                      <Check className="size-4 md:size-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                note && (
                  <>
                    <div className="flex items-start gap-2">
                      <MarkdownEditor
                        readOnly
                        value={note.content}
                        className="min-w-0 flex-1 [--md-padding:0]"
                        onReferenceClick={navigateReference}
                      />
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label="Edit note"
                          title="Edit note"
                          onClick={startNoteEdit}
                          className={cn(tap, "text-muted-foreground hover:text-foreground")}
                        >
                          <Pencil className="size-4 md:size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete note"
                          title="Delete note"
                          onClick={deleteNote}
                          className={cn(tap, "text-muted-foreground hover:text-destructive")}
                        >
                          <Trash2 className="size-4 md:size-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className={cn(tiny, "mt-1 flex items-center gap-2")}>
                      <time>{format(note.createdAt, "d MMM HH:mm")}</time>
                      {unsyncedAnnotations.has(note.id) && (
                        <CloudOff className="size-2.5" aria-label="only on this device so far" />
                      )}
                      {!!note.edits?.length && <span>edited</span>}
                    </p>
                  </>
                )
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      {!editing && selected && (
        // Metadata is only for the message you're looking at: date, unsynced/voice/edited, and the
        // actions. One row-select-ignore zone (see rowSelect.ts) — the ⋯ menu and the "edited"
        // toggle both live here, and neither should select the row out from under their own click.
        <p {...{ [ROW_SELECT_IGNORE]: "" }} className={`mt-1.5 flex min-h-9 items-center gap-2.5 ${tiny}`}>
          <time>{format(m.createdAt, "d MMM HH:mm")}</time>
          {!!m.meta?.voice && <Mic className="size-2.5" aria-label="voice" />}
          {pending && <CloudOff className="size-2.5" aria-label="only on this device so far" />}
          {!!m.edits?.length && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setHistory((h) => !h)}>
              edited
            </button>
          )}
          {mine && (
            <Menu
              align="end"
              onCloseAutoFocus={(e) => {
                // "Add note" opens a popover whose editor autofocuses; without this Radix hands focus
                // back to the ⋯ trigger a beat later and the popover's editor loses it.
                if (!openNoteAfterMenu.current) return;
                openNoteAfterMenu.current = false;
                e.preventDefault();
                onNoteOpenChange(true);
              }}
              trigger={
                <button
                  type="button"
                  aria-label="Message actions"
                  title="Message actions"
                  className={cn(tap, "ml-auto -mr-2.5 text-muted-foreground hover:text-foreground")}
                >
                  <MoreHorizontal className="size-4 md:size-3.5" />
                </button>
              }
              items={[
                { label: "Edit", icon: Pencil, onClick: startEdit },
                { label: "Copy", icon: Copy, onClick: copyText },
                ...(note
                  ? []
                  : [
                      {
                        label: "Add note",
                        icon: StickyNote,
                        onClick: () => {
                          openNoteAfterMenu.current = true;
                        },
                      },
                    ]),
                { label: "Clone from here", icon: GitBranchPlus, onClick: onCopyThread },
                { label: "Copy link", icon: Link, onClick: copyLink },
                m.meta?.todo
                  ? { label: "Todo", icon: SquareCheck, onClick: () => onSetTodo(null) }
                  : { label: "Todo", icon: Square, onClick: () => onSetTodo(false) },
              ]}
            />
          )}
        </p>
      )}

      {history &&
        selected &&
        !editing &&
        [...(m.edits ?? [])].reverse().map((v) => (
          <div key={v.at} className="mt-2 border-l-2 border-border pl-3 opacity-70">
            <p className={tiny}>{format(v.at, "d MMM HH:mm")}</p>
            <MarkdownEditor
              readOnly
              value={v.content}
              className="[--md-padding:0]"
              onReferenceClick={navigateReference}
            />
          </div>
        ))}
    </Motion.article>
  );
};

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownUp, ArrowLeft, SearchX, X } from "lucide-react";
import { AnimatePresence, m as Motion } from "motion/react";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Eyebrow } from "@/components/ui/eyebrow";
import { toast } from "@/components/ui/toast";
import { Composer } from "@/features/composer";
import { MarkdownEditor } from "@/features/editor";
import { api } from "@/lib/api";
import { getThreadLocal } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { resolveMessageRange } from "@/lib/references";
import { useStatus } from "@/lib/status";
import { onChange, pullThreads } from "@/lib/sync";
import { orderMessages, setThreadReversed, useThreadReversed } from "@/lib/threadOrder";
import type { Thread } from "@/lib/types";
import { EntryRow } from "./EntryRow";
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
  // after a todo jump the target stays selected, and this is the way to let go of it. Menus, popovers
  // and sheets render in portals but still bubble React events up through their row, so anything whose
  // DOM isn't inside this view is ignored outright.
  const onBackgroundClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (!e.currentTarget.contains(target)) return;
    if (composerRef.current?.contains(document.activeElement) && !target.closest("[data-composer]"))
      (document.activeElement as HTMLElement | null)?.blur();
    if (selectedMessageId && !target.closest("article")) onSelectMessage(null);
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
      <header className="surface-sheen border-b border-border">
        {/* Padding lives inside the `max-w-3xl` box (like the message column and composer below), so the
            title starts at the same x as the messages instead of 40px left of them. */}
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-2 py-1.5 md:px-9 lg:gap-2 lg:py-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to index"
            className="shrink-0 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <h1
            title={thread?.title}
            className="min-w-0 truncate pl-1 text-[17px] font-semibold leading-tight lg:pl-0 lg:font-serif lg:text-2xl lg:font-normal lg:tracking-tight"
          >
            {thread?.title ?? "…"}
          </h1>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto shrink-0 aria-pressed:bg-accent aria-pressed:text-foreground"
            aria-label={
              reversed
                ? "Showing newest first — switch to oldest first"
                : "Showing oldest first — switch to newest first"
            }
            title={reversed ? "Newest first" : "Oldest first"}
            aria-pressed={reversed}
            onClick={() => setThreadReversed(threadId, !reversed)}
          >
            <ArrowDownUp className="size-5 md:size-4" />
          </Button>
        </div>
      </header>

      {error && <p className="border-b border-destructive px-7 py-2 text-xs text-destructive md:px-10">{error}</p>}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
        }}
      >
        <div className="flex min-h-full flex-col">
          <div className="mx-auto w-full max-w-3xl flex-1 px-7 pb-6 md:px-10">
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
                  className="surface-sheen mt-4 rounded-2xl border border-dashed border-border p-4"
                >
                  <Eyebrow className="flex items-center justify-between">
                    Scratch
                    <Button
                      size="icon"
                      variant="ghost"
                      className="-my-3 -mr-3"
                      aria-label="Dismiss scratch answer"
                      title="Dismiss"
                      onClick={() => setScratch(null)}
                    >
                      <X className="size-5 md:size-4" />
                    </Button>
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
  <div className="surface-background flex h-full flex-col items-center justify-center gap-3 px-7">
    <Empty icon={SearchX} className="py-0">
      Not found
    </Empty>
    <Button variant="secondary" onClick={onBack}>
      <ArrowLeft className="size-5 md:size-4" /> Back
    </Button>
  </div>
);

const FOLLOW_SLACK_PX = 96; // closer than this to the bottom still counts as "at the newest entry"

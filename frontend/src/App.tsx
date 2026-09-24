import { domAnimation, LazyMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ToastProvider } from "@/components/ui/toast";
import { BackgroundLayer } from "@/features/appearance";
import { ConnectionDialog } from "@/features/connection";
import { CommandPalette } from "@/features/palette";
import { createOrReuseThread, ThreadList, ThreadView } from "@/features/threads";
import { cn } from "@/lib/cn";
import { deepLinkUrl, parseDeepLink } from "@/lib/deepLink";
import { shortcutBlocked } from "@/lib/dom";
import { useStatus } from "@/lib/status";

// Two panes: the index (left rail) and the open thread. On a phone one at a time.
// The shell is keyed by mode: switching stores remounts every view so nothing
// keeps rendering the other store's data. Drafts survive (useDraft); the dialog
// lives outside the key so a sync's result stays on screen across the switch.
// `LazyMotion` + the `m` component (used by Popover/ThreadView/Composer) load only the
// fade/scale/exit feature set instead of Motion's full bundle (which also carries drag and
// layout animation code this app never uses) — one provider up here covers all of them.
export const App = () => {
  const { mode } = useStatus();
  const [selected, setSelectedRaw] = useState<string | null>(null); // survives a mode switch: same thread, other store
  // The open thread's currently-selected message — thread-scoped (cleared any time `selected`
  // changes), mirrors `selected`/its setters exactly: a controlled value down to ThreadView plus
  // an `onSelectMessage` callback for a plain in-thread click. Reflected in `?msg=` by the URL-sync
  // effect below, same as `selected` is reflected in `?thread=`.
  const [selectedMessageId, setSelectedMessageIdRaw] = useState<string | null>(null);
  // Set once by a `/capture` deep link (the manifest's `shortcuts` entry, or `?capture` typed
  // directly): scopes the composer autofocus to that one freshly-opened thread, not every thread
  // you open afterward — `selected` moves on the moment you navigate away.
  const [captureId, setCaptureId] = useState<string | null>(null);
  // A one-shot "this message just arrived via navigation" signal — a todo row's click or landing
  // on a `?thread=&msg=` link — as opposed to `selectedMessageId` changing from a plain in-thread
  // click. Only this case gets scrolled into view and pulsed (ThreadView's `pulseMessageId`);
  // `openThreadAt` is the one place that sets it, same message any of those paths carry.
  const [pulseTarget, setPulseTarget] = useState<{ threadId: string; messageId: string } | null>(null);
  // Seeds the URL-sync effect below so the very first write after a `?thread=&msg=` deep link (or
  // a `/capture` one) lands as a `replaceState`, not a `pushState` — it's establishing the URL for
  // wherever the page already says it landed, not a new user-driven navigation.
  const lastSyncedThread = useRef<string | null>(null);
  const urlSyncPending = useRef(true); // true until the first post-mount render, so this effect's very first pass (before any deep-link effect below has resolved) never writes a premature "nothing selected" URL over one that's still being parsed

  /** The one place that opens a thread — optionally jumping straight to one message in it (a todo
   * row's click, or a `?thread=&msg=` deep link). Every navigational path funnels through here so
   * the URL-sync effect only has one kind of state change to react to. */
  const openThreadAt = useCallback((threadId: string, messageId?: string) => {
    setSelectedRaw(threadId);
    setSelectedMessageIdRaw(messageId ?? null);
    setPulseTarget(messageId ? { threadId, messageId } : null);
  }, []);

  /** Leaves the open thread entirely (the mobile back arrow, Escape, a deletion) — clears the
   * message selection and pulse target right along with it, same as switching to a different
   * thread does. */
  const closeThread = useCallback(() => {
    setSelectedRaw(null);
    setSelectedMessageIdRaw(null);
    setPulseTarget(null);
  }, []);

  /** A plain in-thread click (toggling which message is selected): message-scoped only, no thread
   * change, and — unlike `openThreadAt` — no pulse. It's already on screen; there's nothing to
   * scroll to or draw the eye to. */
  const onSelectMessage = useCallback((id: string | null) => {
    setSelectedMessageIdRaw(id);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("capture")) return;
    params.delete("capture");
    const search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
    createOrReuseThread().then((id) => {
      lastSyncedThread.current = id; // seed: the URL-sync effect's first write for this thread is a replace, not a push
      setSelectedRaw(id);
      setCaptureId(id);
    });
  }, []);

  // `?thread=<id>&msg=<id>`: the shareable/back-button-able form of a todo jump (see TodosPanel).
  // Reading is the only thing this effect does now — writing the canonical URL back (whether from
  // this deep link or any later navigation) is the URL-sync effect below's job alone.
  useEffect(() => {
    const { threadId, messageId } = parseDeepLink(location.search);
    if (!threadId) return;
    lastSyncedThread.current = threadId; // seed: same reasoning as the capture effect above
    openThreadAt(threadId, messageId ?? undefined);
  }, [openThreadAt]);

  // The pushes below only earn "the back button steps between threads" if back/forward actually
  // lands somewhere: this re-applies whatever the URL now says. Seeding `lastSyncedThread` first
  // (same trick as the two effects above) tells the sync effect this state change already matches
  // the URL the browser just navigated to, so it replaces in place instead of pushing a new entry
  // right back on top of the one the user just stepped off of.
  useEffect(() => {
    const onPopState = () => {
      const { threadId, messageId } = parseDeepLink(location.search);
      lastSyncedThread.current = threadId;
      if (threadId) openThreadAt(threadId, messageId ?? undefined);
      else closeThread();
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, [openThreadAt, closeThread]);

  // The single place the URL is ever written from: `?thread=&msg=` always mirrors `selected`/
  // `selectedMessageId`, however they got there (a click, a todo jump, a deep link). Push when the
  // thread changes (so the back button steps between threads), replace when only the message
  // selection changes within the same thread (toggling a selection shouldn't spam history).
  useEffect(() => {
    if (urlSyncPending.current) {
      // Mount's first pass always sees the pre-effect state (null, or whatever a lazy initializer
      // set) — the capture/deep-link effects above haven't run their `setState` yet this render.
      // Skip writing anything until their result shows up as a real prop change on a later pass.
      urlSyncPending.current = false;
      return;
    }
    const url = deepLinkUrl(location.pathname, location.hash, selected, selectedMessageId);
    if (selected === lastSyncedThread.current) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    lastSyncedThread.current = selected;
  }, [selected, selectedMessageId]);

  return (
    <ToastProvider>
      <LazyMotion features={domAnimation}>
        <BackgroundLayer />
        {mode === "local" && (
          <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 bg-primary" />
        )}
        <Shell
          key={mode}
          selected={selected}
          closeThread={closeThread}
          autofocus={!!selected && selected === captureId}
          openThreadAt={openThreadAt}
          selectedMessageId={selectedMessageId}
          onSelectMessage={onSelectMessage}
          pulseMessageId={selected && pulseTarget?.threadId === selected ? pulseTarget.messageId : undefined}
        />
        <ConnectionDialog />
        <CommandPalette onOpen={openThreadAt} />
      </LazyMotion>
    </ToastProvider>
  );
};

const Shell = ({
  selected,
  closeThread,
  autofocus,
  openThreadAt,
  selectedMessageId,
  onSelectMessage,
  pulseMessageId,
}: {
  selected: string | null;
  closeThread: () => void;
  autofocus: boolean;
  openThreadAt: (threadId: string, messageId?: string) => void;
  selectedMessageId: string | null;
  onSelectMessage: (id: string | null) => void;
  pulseMessageId: string | undefined;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !shortcutBlocked(e)) closeThread();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [closeThread]);

  return (
    // z-10: stacks above BackgroundLayer's fixed z-0 wallpaper (App.tsx) regardless of paint
    // order. The aside/main panes are themselves translucent (bg-*/92, no blur — see AGENTS.md's
    // Appearance note) so the wallpaper still shows faintly through; only floating chrome
    // (popovers, dropdown menus) also gets backdrop-blur, reserved for exactly that per Wigl's
    // pattern this was ported from.
    <div className="relative z-10 grid h-dvh lg:grid-cols-[23rem_1fr]">
      <aside className={cn("min-h-0 border-r border-border bg-secondary/92", selected && "hidden lg:block")}>
        <ThreadList onOpen={openThreadAt} selectedId={selected} onDeleted={(id) => id === selected && closeThread()} />
      </aside>
      <main className={cn("min-h-0", !selected && "hidden lg:block")}>
        {selected ? (
          <ThreadView
            key={selected}
            threadId={selected}
            onBack={closeThread}
            onCopied={(id) => openThreadAt(id)}
            autofocus={autofocus}
            selectedMessageId={selectedMessageId}
            onSelectMessage={onSelectMessage}
            pulseMessageId={pulseMessageId}
            onNavigateReference={openThreadAt}
          />
        ) : (
          <Blank />
        )}
      </main>
    </div>
  );
};

const Blank = () => (
  <div className="flex h-full flex-col items-center justify-center gap-4 bg-background/92 px-8 text-center">
    <p className="font-serif text-3xl italic text-muted-foreground">Pick a thread, or start one.</p>
    <Eyebrow>
      <kbd>⌘k</kbd> jump · <kbd>/</kbd> search · <kbd>n</kbd> new · <kbd>esc</kbd> close · <kbd>⌘↵</kbd> send
    </Eyebrow>
  </div>
);

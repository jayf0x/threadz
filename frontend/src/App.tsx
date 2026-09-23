import { domAnimation, LazyMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ConnectionDialog } from "@/features/connection";
import { createOrReuseThread, ThreadList, ThreadView } from "@/features/threads";
import { cn } from "@/lib/cn";
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
  const [selected, setSelected] = useState<string | null>(null); // survives a mode switch: same thread, other store
  // Set once by a `/capture` deep link (the manifest's `shortcuts` entry, or `?capture` typed
  // directly): scopes the composer autofocus to that one freshly-opened thread, not every thread
  // you open afterward — `selected` moves on the moment you navigate away.
  const [captureId, setCaptureId] = useState<string | null>(null);
  // Set by the `?thread=<id>&msg=<id>` deep link (below) or a todo row's click (TodosPanel, via
  // ThreadList): the message to scroll to and flash once the thread is open. `openThreadAt` is the
  // one place that does this — the query-param effect and the todo click both call it instead of
  // each carrying their own copy of "open this thread, then jump to this message".
  const [scrollTarget, setScrollTarget] = useState<{ threadId: string; messageId: string } | null>(null);

  const openThreadAt = useCallback((threadId: string, messageId?: string) => {
    setSelected(threadId);
    setScrollTarget(messageId ? { threadId, messageId } : null);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("capture")) return;
    params.delete("capture");
    const search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
    createOrReuseThread().then((id) => {
      setSelected(id);
      setCaptureId(id);
    });
  }, []);

  // `?thread=<id>&msg=<id>`: the shareable/back-button-able form of a todo jump (see TodosPanel).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const threadId = params.get("thread");
    if (!threadId) return;
    const messageId = params.get("msg") ?? undefined;
    params.delete("thread");
    params.delete("msg");
    const search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
    openThreadAt(threadId, messageId);
  }, [openThreadAt]);

  return (
    <LazyMotion features={domAnimation}>
      {mode === "local" && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 bg-primary" />
      )}
      <Shell
        key={mode}
        selected={selected}
        setSelected={setSelected}
        autofocus={!!selected && selected === captureId}
        openThreadAt={openThreadAt}
        scrollToMessageId={selected && scrollTarget?.threadId === selected ? scrollTarget.messageId : undefined}
      />
      <ConnectionDialog />
    </LazyMotion>
  );
};

const Shell = ({
  selected,
  setSelected,
  autofocus,
  openThreadAt,
  scrollToMessageId,
}: {
  selected: string | null;
  setSelected: (id: string | null) => void;
  autofocus: boolean;
  openThreadAt: (threadId: string, messageId?: string) => void;
  scrollToMessageId: string | undefined;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !shortcutBlocked(e)) setSelected(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [setSelected]);

  return (
    <div className="grid h-dvh lg:grid-cols-[23rem_1fr]">
      <aside className={cn("min-h-0 border-r border-border bg-secondary", selected && "hidden lg:block")}>
        <ThreadList
          onOpen={openThreadAt}
          selectedId={selected}
          onDeleted={(id) => id === selected && setSelected(null)}
        />
      </aside>
      <main className={cn("min-h-0", !selected && "hidden lg:block")}>
        {selected ? (
          <ThreadView
            key={selected}
            threadId={selected}
            onBack={() => setSelected(null)}
            onCopied={setSelected}
            autofocus={autofocus}
            scrollToMessageId={scrollToMessageId}
          />
        ) : (
          <Blank />
        )}
      </main>
    </div>
  );
};

const Blank = () => (
  <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
    <p className="font-serif text-3xl italic text-muted-foreground">Pick a thread, or start one.</p>
    <Eyebrow>
      <kbd>/</kbd> search · <kbd>n</kbd> new · <kbd>esc</kbd> close · <kbd>⌘↵</kbd> send
    </Eyebrow>
  </div>
);

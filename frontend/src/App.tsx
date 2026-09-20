import { useEffect, useState } from "react";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { ThreadList } from "@/components/ThreadList";
import { ThreadView } from "@/components/ThreadView";
import { cn } from "@/lib/cn";
import { isTypingTarget } from "@/lib/dom";
import { useStatus } from "@/lib/status";

// Two panes: the index (left rail) and the open thread. On a phone one at a time.
// The shell is keyed by mode: switching stores remounts every view so nothing
// keeps rendering the other store's data. Drafts survive (useDraft); the dialog
// lives outside the key so a sync's result stays on screen across the switch.
export const App = () => {
  const { mode } = useStatus();
  const [selected, setSelected] = useState<string | null>(null); // survives a mode switch: same thread, other store
  return (
    <>
      {mode === "local" && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 bg-primary" />
      )}
      <Shell key={mode} selected={selected} setSelected={setSelected} />
      <ConnectionDialog />
    </>
  );
};

const Shell = ({ selected, setSelected }: { selected: string | null; setSelected: (id: string | null) => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e)) setSelected(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [setSelected]);

  return (
    <div className="grid h-dvh lg:grid-cols-[23rem_1fr]">
      <aside className={cn("min-h-0 border-r border-border bg-secondary", selected && "hidden lg:block")}>
        <ThreadList
          onOpen={setSelected}
          selectedId={selected}
          onDeleted={(id) => id === selected && setSelected(null)}
        />
      </aside>
      <main className={cn("min-h-0", !selected && "hidden lg:block")}>
        {selected ? <ThreadView key={selected} threadId={selected} onBack={() => setSelected(null)} /> : <Blank />}
      </main>
    </div>
  );
};

const Blank = () => (
  <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
    <p className="font-serif text-3xl italic text-muted-foreground">Pick a thread, or start one.</p>
    <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <kbd>/</kbd> search · <kbd>n</kbd> new · <kbd>esc</kbd> close · <kbd>⌘↵</kbd> send
    </p>
  </div>
);

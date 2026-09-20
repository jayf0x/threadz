import { useEffect, useState } from "react";
import { ThreadList } from "@/components/ThreadList";
import { ThreadView } from "@/components/ThreadView";
import { cn } from "@/lib/cn";

// Two panes: the index (left rail) and the open thread. On a phone one at a time.
export const App = () => {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea,select") && setSelected(null);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-dvh lg:grid-cols-[23rem_1fr]">
      <aside className={cn("min-h-0 border-r border-border bg-secondary", selected && "hidden lg:block")}>
        <ThreadList onOpen={setSelected} selectedId={selected} />
      </aside>
      <main className={cn("min-h-0", !selected && "hidden lg:block")}>
        {selected ? (
          <ThreadView key={selected} threadId={selected} onBack={() => setSelected(null)} onDeleted={() => setSelected(null)} />
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
    <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <kbd>/</kbd> search · <kbd>n</kbd> new · <kbd>esc</kbd> close · <kbd>⌘↵</kbd> send
    </p>
  </div>
);

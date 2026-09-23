import { format } from "date-fns";
import { Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { stripTodoMarker } from "@/lib/todos";
import { useTodos } from "./useTodos";

// The sidebar's third view: every `@/todo`/`- [ ] ` line across every thread (see `lib/todos.ts`),
// newest first. Ticking a box rewrites that line in place (open<->closed) through the same
// `editMessage` every other edit uses — text is the only source of truth, there's no separate "done"
// flag anywhere. Closed todos are hidden by default; the header toggle reveals them. Tap the rest of
// a row to jump to its thread.
export const TodosPanel = ({ onOpenThread }: { onOpenThread: (threadId: string) => void }) => {
  const { todos, toggle } = useTodos();
  const [showClosed, setShowClosed] = useState(false);

  const openCount = todos?.filter((t) => !t.done).length ?? 0;
  const closedCount = todos?.filter((t) => t.done).length ?? 0;
  const visible = todos?.filter((t) => showClosed || !t.done) ?? null;

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Todos</h1>
        <div className="mt-2 flex items-center justify-between gap-3">
          <Eyebrow>{todos === null ? "Reading…" : `${openCount} open · ${closedCount} closed`}</Eyebrow>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowClosed((v) => !v)}
            className="h-auto px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-widest"
          >
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {visible?.length === 0 && (
          <p className="px-5 py-12 font-serif text-lg italic text-muted-foreground">
            {showClosed
              ? "Nothing here. Every checklist item you've written is still open — or you haven't written one yet."
              : "Nothing open. Every checklist item you've written is checked off — or you haven't written one yet."}
          </p>
        )}
        <ul>
          {visible?.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-[1.25rem_1fr] items-start gap-x-3 border-b border-rule px-5 py-3.5"
            >
              <button
                type="button"
                onClick={() => toggle(t)}
                aria-label={t.done ? "Mark todo open" : "Mark todo done"}
                className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.done ? (
                  <SquareCheck aria-hidden className="size-3.5" />
                ) : (
                  <Square aria-hidden className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenThread(t.threadId)}
                className="min-w-0 text-left transition-colors hover:text-foreground"
              >
                <span
                  className={cn(
                    "block truncate text-sm",
                    t.done ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {stripTodoMarker(t.text)}
                </span>
                <span className="mt-1 block font-mono text-[11px] uppercase text-muted-foreground">
                  {t.threadTitle} · {format(t.createdAt, "d MMM")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

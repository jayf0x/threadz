import { format } from "date-fns";
import { Square } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { stripTodoMarker } from "@/lib/todos";
import { useOpenTodos } from "./useOpenTodos";

// The sidebar's third view: every open `- [ ] ` line across every thread, read-only. Ticking a box
// is a content edit (would need the same edit-with-history machinery as any other message edit, and
// two devices ticking different boxes offline would silently lose one under "newest text wins") — see
// backlog.md. This just finds them and links back to their thread.
export const TodosPanel = ({ onOpenThread }: { onOpenThread: (threadId: string) => void }) => {
  const todos = useOpenTodos();

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Todos</h1>
        <Eyebrow className="mt-2">
          {todos === null ? "Reading…" : `${todos.length} open todo${todos.length === 1 ? "" : "s"}`}
        </Eyebrow>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {todos?.length === 0 && (
          <p className="px-5 py-12 font-serif text-lg italic text-muted-foreground">
            Nothing open. Every checklist item you've written is checked off — or you haven't written one yet.
          </p>
        )}
        <ul>
          {todos?.map((t) => (
            <li key={t.id} className="border-b border-rule">
              <button
                type="button"
                onClick={() => onOpenThread(t.threadId)}
                className="grid w-full grid-cols-[1.25rem_1fr] items-start gap-x-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/50"
              >
                <Square aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{stripTodoMarker(t.text)}</span>
                  <span className="mt-1 block font-mono text-[11px] uppercase text-muted-foreground">
                    {t.threadTitle} · {format(t.createdAt, "d MMM")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

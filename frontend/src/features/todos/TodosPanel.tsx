import { format } from "date-fns";
import { Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { type ParsedTodoItem, stripTodoMarker, type Todo } from "@/lib/todos";
import { useTodos } from "./useTodos";

// A "group" todo has no single done state — count/filter its items individually, same as a flat
// line or message todo counts as one.
const isItemVisible = (t: Todo, showClosed: boolean) =>
  t.kind === "group" ? showClosed || t.items.some((i) => !i.done) : showClosed || !t.done;

const countBy = (todos: Todo[], done: boolean) =>
  todos.reduce(
    (n, t) => (t.kind === "group" ? n + t.items.filter((i) => i.done === done).length : n + (t.done === done ? 1 : 0)),
    0,
  );

// The sidebar's third view: every `@/todo`/`@/todos`/`- [ ] ` line, plus every message flagged via
// the ⋯ menu's "Add to Todos", across every thread (see `lib/todos.ts`), newest first. Ticking a box
// rewrites that line in place (open<->closed) through the same `editMessage` every other edit uses —
// except a flagged message, which has no line to rewrite and flips `meta.todo.done` directly (see
// `useTodos.ts`'s `toggle`). Closed todos are hidden by default; the header toggle reveals them. Tap
// the rest of a row to jump to its thread, scrolled and highlighted at the exact message.
export const TodosPanel = ({ onOpenThread }: { onOpenThread: (threadId: string, messageId: string) => void }) => {
  const { todos, toggle } = useTodos();
  const [showClosed, setShowClosed] = useState(false);

  const openCount = todos ? countBy(todos, false) : 0;
  const closedCount = todos ? countBy(todos, true) : 0;
  const visible = todos?.filter((t) => isItemVisible(t, showClosed)) ?? null;

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
          {visible?.map((t) => {
            const meta = `${t.threadTitle} · ${format(t.createdAt, "d MMM")}`;
            if (t.kind === "group")
              return (
                <GroupCard
                  key={t.id}
                  title={t.title}
                  meta={meta}
                  items={showClosed ? t.items : t.items.filter((i) => !i.done)}
                  onToggleItem={(item) => toggle(t, item)}
                  onOpenThread={() => onOpenThread(t.threadId, t.messageId)}
                />
              );
            const text = t.kind === "line" ? stripTodoMarker(t.text) : t.messageContent;
            return (
              <TodoRow
                key={t.id}
                text={text}
                done={t.done}
                onToggle={() => toggle(t)}
                onOpen={() => onOpenThread(t.threadId, t.messageId)}
                meta={meta}
              />
            );
          })}
        </ul>
      </div>
    </>
  );
};

const TodoRow = ({
  text,
  done,
  onToggle,
  onOpen,
  meta,
}: {
  text: string;
  done: boolean;
  onToggle: () => void;
  onOpen: () => void;
  meta: string;
}) => (
  <li className="grid grid-cols-[1.25rem_1fr] items-start gap-x-3 border-b border-rule px-5 py-3.5">
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? "Mark todo open" : "Mark todo done"}
      className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
    >
      {done ? <SquareCheck aria-hidden className="size-3.5" /> : <Square aria-hidden className="size-3.5" />}
    </button>
    <button type="button" onClick={onOpen} className="min-w-0 text-left transition-colors hover:text-foreground">
      <span className={cn("block truncate text-sm", done ? "text-muted-foreground line-through" : "text-foreground")}>
        {text}
      </span>
      <span className="mt-1 block font-mono text-[11px] uppercase text-muted-foreground">{meta}</span>
    </button>
  </li>
);

// A `@/todos <title>` group: one card, its own header (tap to jump, like a plain row) and each item
// as its own toggle-able line underneath — not N flat rows mixed in with everything else.
const GroupCard = ({
  title,
  meta,
  items,
  onToggleItem,
  onOpenThread,
}: {
  title: string;
  meta: string;
  items: ParsedTodoItem[];
  onToggleItem: (item: ParsedTodoItem) => void;
  onOpenThread: () => void;
}) => (
  <li className="border-b border-rule px-5 py-3.5">
    <button
      type="button"
      onClick={onOpenThread}
      className="mb-2 block min-w-0 text-left transition-colors hover:text-foreground"
    >
      <span className="block truncate text-sm font-medium text-foreground">{title}</span>
      <span className="mt-1 block font-mono text-[11px] uppercase text-muted-foreground">{meta}</span>
    </button>
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.lineIndex} className="grid grid-cols-[1.25rem_1fr] items-start gap-x-2 pl-1">
          <button
            type="button"
            onClick={() => onToggleItem(item)}
            aria-label={item.done ? "Mark item open" : "Mark item done"}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            {item.done ? <SquareCheck aria-hidden className="size-3.5" /> : <Square aria-hidden className="size-3.5" />}
          </button>
          <span
            className={cn("truncate text-sm", item.done ? "text-muted-foreground line-through" : "text-foreground")}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  </li>
);

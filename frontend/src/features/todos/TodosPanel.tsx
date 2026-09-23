import { format } from "date-fns";
import { Eye, EyeOff, History, type LucideIcon, Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { type ClosedFilter, isTodoVisible, type ParsedTodoItem, stripTodoMarker, type Todo } from "@/lib/todos";
import { useTodos } from "./useTodos";

const CLOSED_FILTER_OPTIONS: { value: ClosedFilter; label: string; icon: LucideIcon }[] = [
  { value: "always", label: "Always show closed", icon: Eye },
  { value: "recent", label: "Show recently closed", icon: History },
  { value: "never", label: "Never show closed", icon: EyeOff },
];

const countBy = (todos: Todo[], done: boolean) =>
  todos.reduce(
    (n, t) => (t.kind === "group" ? n + t.items.filter((i) => i.done === done).length : n + (t.done === done ? 1 : 0)),
    0,
  );

// The sidebar's third view: every `@/todo`/`@/todos`/`- [ ] ` line, plus every message flagged via
// the ⋯ menu's "Add to Todos", across every thread (see `lib/todos.ts`), newest first. Ticking a box
// rewrites that line in place (open<->closed) through the same `editMessage` every other edit uses —
// except a flagged message, which has no line to rewrite and flips `meta.todo.done` directly (see
// `useTodos.ts`'s `toggle`). The closed-todo filter (default: recently closed) only ever hides flat
// line/message entries — a `@/todos` group always shows every one of its items. Tap the rest of a
// row to jump to its thread, scrolled and highlighted at the exact message.
export const TodosPanel = ({ onOpenThread }: { onOpenThread: (threadId: string, messageId: string) => void }) => {
  const { todos, toggle } = useTodos();
  const [closedFilter, setClosedFilter] = useState<ClosedFilter>("recent");

  const openCount = todos ? countBy(todos, false) : 0;
  const closedCount = todos ? countBy(todos, true) : 0;
  const now = Date.now();
  const visible = todos?.filter((t) => isTodoVisible(t, closedFilter, now)) ?? null;

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Todos</h1>
        <div className="mt-2 flex items-center justify-between gap-3">
          <Eyebrow>{todos === null ? "Reading…" : `${openCount} open · ${closedCount} closed`}</Eyebrow>
          <ClosedFilterSwitcher filter={closedFilter} setFilter={setClosedFilter} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {visible?.length === 0 && (
          <p className="px-5 py-12 font-serif text-lg italic text-muted-foreground">
            {closedFilter === "never"
              ? "Nothing open. Every checklist item you've written is checked off — or you haven't written one yet."
              : "Nothing here. Every checklist item you've written is still open — or you haven't written one yet."}
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
                  items={t.items}
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

// Three-way closed-todo filter — same segmented-fieldset pattern as `ThemeToggle`: icon-only pills,
// a `title` (and sr-only label) per option since the icons alone don't spell out "recently" vs
// "always"/"never".
const ClosedFilterSwitcher = ({
  filter,
  setFilter,
}: {
  filter: ClosedFilter;
  setFilter: (f: ClosedFilter) => void;
}) => (
  <fieldset className="flex gap-px border border-border p-px">
    <legend className="sr-only">Closed todos</legend>
    {CLOSED_FILTER_OPTIONS.map(({ value, label, icon: Icon }) => {
      const active = filter === value;
      return (
        <label
          key={value}
          title={label}
          className={cn(
            "flex cursor-pointer items-center p-1.5 transition-colors has-focus-visible:outline",
            "has-focus-visible:outline-ring",
            active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name="closed-filter"
            value={value}
            checked={active}
            onChange={() => setFilter(value)}
            className="sr-only"
          />
          <Icon aria-hidden className="size-3.5" />
          <span className="sr-only">{label}</span>
        </label>
      );
    })}
  </fieldset>
);

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
// as its own toggle-able line underneath — not N flat rows mixed in with everything else. Always
// renders every item, regardless of the closed-todo filter (see `isVisible`).
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

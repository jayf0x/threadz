import { format } from "date-fns";
import { Circle, CircleCheck, ListFilter, ListTodo } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Empty } from "@/components/ui/empty";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconSelect } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { type ClosedFilter, isTodoVisible, type ParsedTodoItem, stripTodoMarker, type Todo } from "@/lib/todos";
import { useTodos } from "./useTodos";

const CLOSED_FILTER_OPTIONS: { value: ClosedFilter; label: string }[] = [
  { value: "recent", label: "Recently closed" },
  { value: "always", label: "All closed" },
  { value: "never", label: "Hide closed" },
];

const countBy = (todos: Todo[], done: boolean) =>
  todos.reduce(
    (n, t) => (t.kind === "group" ? n + t.items.filter((i) => i.done === done).length : n + (t.done === done ? 1 : 0)),
    0,
  );

// The sidebar's Todos view: every `/todo`/`/todos`/`- [ ] ` line, plus every message flagged via
// the ⋯ menu's "Todo" toggle, across every thread (see `lib/todos.ts`), newest first. Ticking a box
// rewrites that line in place (open<->closed) through the same `editMessage` every other edit uses —
// except a flagged message, which has no line to rewrite and flips `meta.todo.done` directly (see
// `useTodos.ts`'s `toggle`). The closed-todo filter (default: recently closed) only ever hides flat
// line/message entries — a `/todos` group always shows every one of its items. Tap the rest of a
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
      <header className="px-5 pb-3 pt-6">
        <h1 className="font-serif text-[32px] leading-none tracking-tight">Todos</h1>
        <div className="mt-2 flex items-center justify-between gap-3">
          <Eyebrow>{todos === null ? "Reading…" : `${openCount} open · ${closedCount} closed`}</Eyebrow>
          <ClosedFilterSwitcher filter={closedFilter} setFilter={setClosedFilter} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-6">
        {visible?.length === 0 && <Empty icon={ListTodo}>{closedFilter === "never" ? "All done" : "No todos"}</Empty>}
        <ul>
          {visible?.map((t) => {
            const meta = <Meta thread={t.threadTitle} at={t.createdAt} />;
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

// The filter lives on the header's right edge as an icon (a rarely-used control), the picker is the platform's.
const ClosedFilterSwitcher = ({
  filter,
  setFilter,
}: {
  filter: ClosedFilter;
  setFilter: (f: ClosedFilter) => void;
}) => (
  <IconSelect
    icon={ListFilter}
    aria-label="Closed todos"
    title="Closed todos"
    value={filter}
    onChange={(e) => {
      const v = CLOSED_FILTER_OPTIONS.find((o) => o.value === e.target.value);
      if (v) setFilter(v.value);
    }}
  >
    {CLOSED_FILTER_OPTIONS.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </IconSelect>
);

// "Thread · 25 Sep": the thread title gives way to the date when it is too long, never the other way round.
const Meta = ({ thread, at }: { thread: string; at: number }) => (
  <span className="mt-0.5 flex text-xs text-muted-foreground">
    <span className="min-w-0 truncate">{thread}</span>
    <span className="shrink-0 whitespace-pre tabular-nums"> · {format(at, "d MMM")}</span>
  </span>
);

// A round tick with a 44px hit area. The glyph pops once when *you* close it, not for every done row
// that happens to mount.
const CheckButton = ({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) => {
  const [popped, setPopped] = useState(false);
  const Icon = done ? CircleCheck : Circle;
  return (
    <button
      type="button"
      onClick={() => {
        setPopped(true);
        onToggle();
      }}
      aria-label={label}
      className="press-icon grid size-11 shrink-0 place-items-center self-start rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className={cn("size-6 transition-colors duration-200", done && "text-primary", done && popped && "check-pop")}
      />
    </button>
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
  meta: ReactNode;
}) => (
  <li className="flex min-h-14 items-stretch border-b border-rule pl-2">
    <CheckButton done={done} onToggle={onToggle} label={done ? "Mark todo open" : "Mark todo done"} />
    <button type="button" onClick={onOpen} className="press-row min-w-0 flex-1 py-2.5 pl-1 pr-5 text-left">
      <span
        className={cn(
          "line-clamp-2 break-words text-[15px] leading-snug transition-colors duration-200",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {text}
      </span>
      {meta}
    </button>
  </li>
);

// A `/todos <title>` group: one card, its own header (tap to jump, like a plain row) and each item
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
  meta: ReactNode;
  items: ParsedTodoItem[];
  onToggleItem: (item: ParsedTodoItem) => void;
  onOpenThread: () => void;
}) => (
  <li className="mx-3 my-2 overflow-hidden rounded-2xl border border-border surface-sheen">
    <button type="button" onClick={onOpenThread} className="press-row block w-full min-w-0 px-4 pb-1.5 pt-3 text-left">
      <span className="line-clamp-2 break-words text-[15px] font-medium leading-snug text-foreground">{title}</span>
      {meta}
    </button>
    <ul className="pb-1.5">
      {items.map((item) => (
        <li key={item.lineIndex} className="flex items-stretch pl-2 pr-4">
          <CheckButton
            done={item.done}
            onToggle={() => onToggleItem(item)}
            label={item.done ? "Mark item open" : "Mark item done"}
          />
          <span
            className={cn(
              "min-w-0 flex-1 break-words py-2.5 pl-1 text-[15px] leading-snug transition-colors duration-200",
              item.done ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  </li>
);

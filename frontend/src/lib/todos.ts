import type { Message, Thread } from "./types";

// Legacy checkbox syntax. Loose, anywhere in the line, not anchored — so "note to self: - [ ] call
// mom" still counts. Open and done are two separate patterns (not `[xX ]?`) so each can be tested on
// its own. Loose on purpose; a false positive here just adds a stray row, never loses data.
const LEGACY_OPEN = /-\s?\[\s*\]/;
const LEGACY_DONE = /-\s?\[\s*[xX]\s*\]/;

// `@/todo <text>` command syntax. Anchored to the start of the (trimmed) line, unlike the legacy
// checkbox — "start of a line" is the whole point of a command trigger, so `I said @/todo nope`
// mid-sentence must NOT match. Closed is real markdown strikethrough wrapping the whole command.
const COMMAND_OPEN = /^@\/todo(?:\s+(.*))?$/;
const COMMAND_DONE = /^~~@\/todo(?:\s+(.*?))?~~$/;

// `@/todos <title>` — a second command, its own trigger (note the "s"; `^@\/todo(?:\s+…)?$` above
// requires end-of-line or whitespace right after "@/todo", so it never matches this one). Anchored
// the same way. The title is everything after the space; empty falls back to "Todos".
const GROUP_TRIGGER = /^@\/todos(?:\s+(.*))?$/;

// A list-item line under a `@/todos` header. Crepe/remark-stringify always serialize a bullet list
// as `- ` (checked against @milkdown/preset-commonmark's bullet-list toMarkdown — it always emits
// the configured `-` bullet regardless of what was typed), so that's the only marker this app itself
// will ever produce; `*`/`+` are accepted too since CommonMark allows them and raw/imported/pasted
// content can still carry them before Crepe ever normalizes it. Order matters: the checkbox variants
// must be tried before the plain one, or `- [x] text` would match PLAIN first (bullet + space + rest).
const LIST_ITEM_DONE = /^[-*+]\s+\[\s*[xX]\s*\]\s*(.*)$/;
const LIST_ITEM_OPEN_CHECKBOX = /^[-*+]\s+\[\s*\]\s*(.*)$/;
const LIST_ITEM_PLAIN = /^[-*+]\s+(.*)$/;

export type ParsedTodo = {
  text: string; // the raw trimmed line, marker(s) included
  done: boolean;
  lineIndex: number; // index into `content.split("\n")` — which line this came from, for editing it back
};

export type ParsedTodoItem = {
  text: string; // display text, marker(s) already stripped
  done: boolean;
  lineIndex: number; // index into `content.split("\n")`, for editing it back (same idea as ParsedTodo)
};

export type ParsedTodoGroup = {
  title: string;
  titleLineIndex: number;
  items: ParsedTodoItem[];
};

const parseListItemLine = (line: string): { text: string; done: boolean } | null => {
  const done = line.match(LIST_ITEM_DONE);
  if (done) return { text: done[1] ?? "", done: true };
  const openChecked = line.match(LIST_ITEM_OPEN_CHECKBOX);
  if (openChecked) return { text: openChecked[1] ?? "", done: false };
  const plain = line.match(LIST_ITEM_PLAIN);
  if (plain) return { text: plain[1] ?? "", done: false };
  return null;
};

// Every `@/todos <title>` group in `content`: the trigger line plus the contiguous run of list-item
// lines right after it — stops at the first blank line or the first line that isn't a list item (a
// paragraph resuming under the header, say). A trigger with nothing under it isn't a group (nothing
// to show), so it's left alone entirely. `consumed` carries every line index a group ate, so
// `parseTodos` below can skip them — a `- [ ]` item under a `@/todos` header must not ALSO come back
// as its own flat legacy todo.
export const parseTodoGroups = (content: string): { groups: ParsedTodoGroup[]; consumed: Set<number> } => {
  const lines = content.split("\n");
  const groups: ParsedTodoGroup[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trigger = line.trim().match(GROUP_TRIGGER);
    if (!trigger) continue;
    const items: ParsedTodoItem[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      if (raw === undefined || raw.trim() === "") break;
      const item = parseListItemLine(raw.trim());
      if (!item) break;
      items.push({ ...item, lineIndex: j });
    }
    if (items.length === 0) continue;
    groups.push({ title: trigger[1]?.trim() || "Todos", titleLineIndex: i, items });
    consumed.add(i);
    for (const it of items) consumed.add(it.lineIndex);
    i = j - 1; // resume scanning right after the consumed run
  }
  return { groups, consumed };
};

// Every single-line todo (either syntax, open or closed) in `content`, trimmed, in source order —
// skipping any line a `@/todos` group above already claimed. Multiple todos in one message each
// come back as their own entry.
export const parseTodos = (content: string): ParsedTodo[] => {
  const { consumed } = parseTodoGroups(content);
  const todos: ParsedTodo[] = [];
  content.split("\n").forEach((raw, lineIndex) => {
    if (consumed.has(lineIndex)) return;
    const line = raw.trim();
    if (COMMAND_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (COMMAND_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
    else if (LEGACY_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (LEGACY_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
  });
  return todos;
};

// A sidebar entry is one of three shapes — a single command/checkbox line, a titled `@/todos` group
// of list items, or a whole message flagged via the ⋯ menu's "Add to Todos" (non-textual, `meta.todo`
// — see backend/schemas.ts's MessageMeta). `kind` is how the sidebar tells them apart; the fields
// every kind shares (thread/message identity, when it was written) are repeated on each rather than
// factored into a base type, so a consumer narrowing on `kind` doesn't have to fight a partial type.
export type LineTodo = {
  kind: "line";
  id: string;
  threadId: string;
  threadTitle: string;
  messageId: string;
  messageContent: string; // full raw content — needed to reconstruct an edit on toggle
  lineIndex: number;
  text: string; // the raw markdown line, marker included
  done: boolean;
  createdAt: number;
  // No per-line "closed at" exists (or is worth building for this). Approximated as the whole
  // message's own edit time — loose on purpose, same "a false positive here costs nothing"
  // philosophy as the legacy checkbox regex above; only used to decide "recent" visibility.
  closedAt: number;
};

export type GroupTodo = {
  kind: "group";
  id: string;
  threadId: string;
  threadTitle: string;
  messageId: string;
  messageContent: string;
  title: string;
  items: ParsedTodoItem[];
  createdAt: number;
};

export type MessageTodo = {
  kind: "message";
  id: string;
  threadId: string;
  threadTitle: string;
  messageId: string;
  messageContent: string;
  done: boolean;
  createdAt: number;
  // Exact: meta has its own edit clock (`metaEditedAt`, backend column `meta_edited_at`) precisely
  // because a meta-only change — this flag — needed to be distinguishable from a content edit.
  closedAt: number;
};

export type Todo = LineTodo | GroupTodo | MessageTodo;

// The sidebar's closed-todo filter (features/todos/TodosPanel.tsx): show every closed entry,
// none, or only ones closed recently.
export type ClosedFilter = "always" | "never" | "recent";

// "Recently closed" window for the filter above — 24h, the backlog's suggested default; not
// configurable (YAGNI, nobody asked for a setting).
export const RECENT_CLOSED_MS = 24 * 60 * 60 * 1000;

// Whether `t` should be visible under `filter` at time `now`. A group's own items are never
// filtered (backlog.md's "Closed-todo filter" point 1) — hiding some of a list you're looking at
// (groceries) reads as broken, not tidy — and a group card itself is never hidden either, even
// when every one of its items is closed: same "don't hide list contents" reasoning.
export const isTodoVisible = (t: Todo, filter: ClosedFilter, now: number): boolean => {
  if (t.kind === "group") return true;
  if (!t.done) return true;
  if (filter === "always") return true;
  if (filter === "never") return false;
  return now - t.closedAt < RECENT_CLOSED_MS;
};

const hasTodoFlag = (m: Message): m is Message & { meta: { todo: { done: boolean } } } =>
  !!m.meta && typeof m.meta.todo === "object" && m.meta.todo !== null && typeof m.meta.todo.done === "boolean";

// Pure cross-thread scan: every todo (line, group or flagged message) across `messages`, newest
// first. The caller decides where `threads`/`messages` come from — see features/todos/useTodos.ts.
export const collectTodos = (threads: Thread[], messages: Message[]): Todo[] => {
  const titleById = new Map(threads.map((t) => [t.id, t.title]));
  const todos: Todo[] = [];
  for (const m of messages) {
    const threadTitle = titleById.get(m.threadId) ?? "Untitled thread";
    const { groups } = parseTodoGroups(m.content);
    groups.forEach((g, i) => {
      todos.push({
        kind: "group",
        id: `${m.id}:group:${i}`,
        threadId: m.threadId,
        threadTitle,
        messageId: m.id,
        messageContent: m.content,
        title: g.title,
        items: g.items,
        createdAt: m.createdAt,
      });
    });
    parseTodos(m.content).forEach((todo, i) => {
      todos.push({
        kind: "line",
        id: `${m.id}:${i}`,
        threadId: m.threadId,
        threadTitle,
        messageId: m.id,
        messageContent: m.content,
        lineIndex: todo.lineIndex,
        text: todo.text,
        done: todo.done,
        createdAt: m.createdAt,
        closedAt: m.editedAt ?? m.createdAt,
      });
    });
    if (hasTodoFlag(m)) {
      todos.push({
        kind: "message",
        id: `${m.id}:message`,
        threadId: m.threadId,
        threadTitle,
        messageId: m.id,
        messageContent: m.content,
        done: m.meta.todo.done,
        createdAt: m.createdAt,
        closedAt: m.metaEditedAt ?? m.createdAt,
      });
    }
  }
  return todos.sort((a, b) => b.createdAt - a.createdAt);
};

// Display text: whichever marker matched (`@/todo `, the `~~` wrapper, `- [ ]`/`- [x]`/plain bullet)
// stripped, for a plain row. Group items don't need this — parseTodoGroups already returns them
// with the marker stripped (see ParsedTodoItem.text).
export const stripTodoMarker = (line: string): string => {
  const commandDone = line.match(COMMAND_DONE);
  if (commandDone) return commandDone[1] ?? "";
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return commandOpen[1] ?? "";
  return line.replace(/^[-*+]\s?\[\s*[xX]?\s*\]\s?/, "").replace(/^[-*+]\s+/, "");
};

// Flips one line between open and closed, preserving its indentation. `lineIndex` is the line's
// index into `content.split("\n")` — a LineTodo's `lineIndex`, or one item's, from the same parse
// that found it. Pure text transform: the caller is responsible for persisting the result
// (`editMessage`). A plain list item with no checkbox (`- buy milk`) toggling to done ADDS the
// checkbox syntax rather than requiring it up front — see backlog.md's grouped-lists item.
export const toggleTodoLine = (content: string, lineIndex: number): string => {
  const lines = content.split("\n");
  const raw = lines[lineIndex];
  if (raw === undefined) return content;
  const indent = raw.slice(0, raw.length - raw.trimStart().length);
  lines[lineIndex] = indent + toggleLine(raw.trim());
  return lines.join("\n");
};

const toggleLine = (line: string): string => {
  const commandDone = line.match(COMMAND_DONE);
  if (commandDone) return `@/todo ${commandDone[1] ?? ""}`;
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return `~~@/todo ${commandOpen[1] ?? ""}~~`;
  if (LEGACY_DONE.test(line)) return line.replace(/\[\s*[xX]\s*\]/, "[ ]");
  if (LEGACY_OPEN.test(line)) return line.replace(/\[\s*\]/, "[x]");
  const listPlain = line.match(LIST_ITEM_PLAIN);
  if (listPlain) {
    const bullet = line.match(/^([-*+])/)?.[1] ?? "-";
    return `${bullet} [x] ${listPlain[1]}`;
  }
  return line;
};

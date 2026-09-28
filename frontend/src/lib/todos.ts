import {
  COMMAND_DONE,
  COMMAND_OPEN,
  LEGACY_DONE,
  LEGACY_OPEN,
  LIST_ITEM_PLAIN,
  type ParsedTodoItem,
  parseTodoGroups,
  parseTodos,
} from "@threadz/core";
import type { Message, Thread } from "./types";

export type { ParsedTodo, ParsedTodoGroup, ParsedTodoItem } from "@threadz/core";
export { parseTodoGroups, parseTodos } from "@threadz/core";

// A sidebar entry is one of three shapes — a single command/checkbox line, a titled `/todos` group
// of list items, or a whole message flagged via the ⋯ menu's "Todo" toggle (non-textual, `meta.todo`
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

// A thread itself flagged via its header ⋯ menu's Todo toggle (Round 6: "a todo on a thread is
// already possible per the schema... status must show in Todos only" — AGENTS.md's "one tab, one
// job" is why this never shows as filtering on the Threadz index). No `messageId`/`messageContent`:
// unlike the other three kinds it isn't about any one message, so its row text is the thread's own
// title (see TodosPanel.tsx).
export type ThreadTodo = {
  kind: "thread";
  id: string;
  threadId: string;
  threadTitle: string;
  done: boolean;
  createdAt: number;
  closedAt: number; // `todos.updated_at`, same role as MessageTodo's `metaEditedAt`
};

export type Todo = LineTodo | GroupTodo | MessageTodo | ThreadTodo;

// The sidebar's closed-todo filter (features/todos/TodosPanel.tsx): show every closed entry,
// none, or only ones closed recently.
export type ClosedFilter = "always" | "never" | "recent";

// "Recently closed" window for the filter above — 24h; not
// configurable (YAGNI, nobody asked for a setting).
export const RECENT_CLOSED_MS = 24 * 60 * 60 * 1000;

// Whether `t` should be visible under `filter` at time `now`. A group's own items are never
// filtered — hiding some of a list you're looking at
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

// Display text: whichever marker matched (`/todo `, the `~~` wrapper, `- [ ]`/`- [x]`/plain bullet)
// stripped, for a plain row. Group items don't need this — parseTodoGroups already returns them
// with the marker stripped (see ParsedTodoItem.text).
export const stripTodoMarker = (line: string): string => {
  const commandDone = line.match(COMMAND_DONE);
  if (commandDone) return commandDone[2] ?? "";
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return commandOpen[2] ?? "";
  return line.replace(/^[-*+]\s?\[\s*[xX]?\s*\]\s?/, "").replace(/^[-*+]\s+/, "");
};

// Flips one line between open and closed, preserving its indentation. `lineIndex` is the line's
// index into `content.split("\n")` — a LineTodo's `lineIndex`, or one item's, from the same parse
// that found it. Pure text transform: the caller is responsible for persisting the result
// (`editMessage`). A plain list item with no checkbox (`- buy milk`) toggling to done ADDS the
// checkbox syntax rather than requiring it up front.
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
  if (commandDone) return `${commandDone[1]} ${commandDone[2] ?? ""}`;
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return `~~${commandOpen[1]} ${commandOpen[2] ?? ""}~~`;
  if (LEGACY_DONE.test(line)) return line.replace(/\[\s*[xX]\s*\]/, "[ ]");
  if (LEGACY_OPEN.test(line)) return line.replace(/\[\s*\]/, "[x]");
  const listPlain = line.match(LIST_ITEM_PLAIN);
  if (listPlain) {
    const bullet = line.match(/^([-*+])/)?.[1] ?? "-";
    return `${bullet} [x] ${listPlain[1]}`;
  }
  return line;
};

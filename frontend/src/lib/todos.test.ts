import { expect, test } from "bun:test";
import {
  collectTodos,
  isTodoVisible,
  type LineTodo,
  parseTodoGroups,
  parseTodos,
  RECENT_CLOSED_MS,
  stripTodoMarker,
  type Todo,
  toggleTodoLine,
} from "./todos";
import type { Message, Thread } from "./types";

test("matches a plain unchecked legacy checkbox", () => {
  expect(parseTodos("- [ ] buy milk")).toEqual([{ text: "- [ ] buy milk", done: false, lineIndex: 0 }]);
});

test("a checked legacy checkbox matches as done", () => {
  expect(parseTodos("- [x] already done")).toEqual([{ text: "- [x] already done", done: true, lineIndex: 0 }]);
  expect(parseTodos("- [X] also done")).toEqual([{ text: "- [X] also done", done: true, lineIndex: 0 }]);
});

test("indented / nested legacy list items still match", () => {
  expect(parseTodos("  - [ ] sub item")).toEqual([{ text: "- [ ] sub item", done: false, lineIndex: 0 }]);
  expect(parseTodos("    - [ ] deeper still")).toEqual([{ text: "- [ ] deeper still", done: false, lineIndex: 0 }]);
});

test("legacy syntax is loose: the literal text mid-sentence still matches", () => {
  expect(parseTodos("I typed - [ ] in the middle of a sentence")).toEqual([
    { text: "I typed - [ ] in the middle of a sentence", done: false, lineIndex: 0 },
  ]);
});

test("@/todo matches only at the start of a (trimmed) line, open", () => {
  expect(parseTodos("@/todo write more docs")).toEqual([{ text: "@/todo write more docs", done: false, lineIndex: 0 }]);
  expect(parseTodos("  @/todo indented command")).toEqual([
    { text: "@/todo indented command", done: false, lineIndex: 0 },
  ]);
});

test("~~@/todo ...~~ matches as closed, real strikethrough wrapping the whole line", () => {
  expect(parseTodos("~~@/todo write more docs~~")).toEqual([
    { text: "~~@/todo write more docs~~", done: true, lineIndex: 0 },
  ]);
});

test("@/todo mid-sentence does NOT match — unlike the deliberately loose legacy checkbox", () => {
  expect(parseTodos("I said @/todo nope, not a command")).toEqual([]);
  expect(parseTodos("see @/todo below")).toEqual([]);
});

test("multiple todos in one message each come back as their own entry, in source order", () => {
  const content = "Groceries:\n- [ ] milk\n- [x] eggs\n@/todo bread\n~~@/todo butter~~\nnot a todo line";
  expect(parseTodos(content)).toEqual([
    { text: "- [ ] milk", done: false, lineIndex: 1 },
    { text: "- [x] eggs", done: true, lineIndex: 2 },
    { text: "@/todo bread", done: false, lineIndex: 3 },
    { text: "~~@/todo butter~~", done: true, lineIndex: 4 },
  ]);
});

test("no todos in a message with none", () => {
  expect(parseTodos("just a plain note, nothing checkable")).toEqual([]);
});

test("stripTodoMarker drops whichever marker matched, keeps the rest", () => {
  expect(stripTodoMarker("- [ ] call mom")).toBe("call mom");
  expect(stripTodoMarker("-[] no spaces")).toBe("no spaces");
  expect(stripTodoMarker("- [x] call mom")).toBe("call mom");
  expect(stripTodoMarker("@/todo call mom")).toBe("call mom");
  expect(stripTodoMarker("~~@/todo call mom~~")).toBe("call mom");
});

test("toggleTodoLine flips legacy open to closed and back, preserving indentation", () => {
  expect(toggleTodoLine("  - [ ] call mom", 0)).toBe("  - [x] call mom");
  expect(toggleTodoLine("  - [x] call mom", 0)).toBe("  - [ ] call mom");
});

test("toggleTodoLine wraps/unwraps the @/todo command in strikethrough", () => {
  expect(toggleTodoLine("@/todo write more docs", 0)).toBe("~~@/todo write more docs~~");
  expect(toggleTodoLine("~~@/todo write more docs~~", 0)).toBe("@/todo write more docs");
});

test("toggleTodoLine only touches the targeted line, leaves the rest of the message alone", () => {
  const content = "notes:\n- [ ] milk\n@/todo bread\nsome other line";
  expect(toggleTodoLine(content, 1)).toBe("notes:\n- [x] milk\n@/todo bread\nsome other line");
  expect(toggleTodoLine(content, 2)).toBe("notes:\n- [ ] milk\n~~@/todo bread~~\nsome other line");
});

const thread = (id: string, title: string): Thread => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  renamedAt: null,
  description: null,
  tags: [],
  hasEmbedding: false,
});

const message = (
  id: string,
  threadId: string,
  content: string,
  createdAt: number,
  meta: Message["meta"] = null,
  extra: Partial<Pick<Message, "editedAt" | "metaEditedAt">> = {},
): Message => ({
  id,
  threadId,
  role: "user",
  content,
  createdAt,
  seq: 1,
  meta,
  ...extra,
});

const asLines = (todos: ReturnType<typeof collectTodos>) =>
  todos.map((t) => {
    if (t.kind !== "line") throw new Error(`expected a line todo, got ${t.kind}`);
    return t as LineTodo;
  });

test("collectTodos scans every thread's messages, newest first, and skips threads/messages with none", () => {
  const threads = [thread("t1", "Groceries"), thread("t2", "Errands")];
  const messages = [
    message("m1", "t1", "- [ ] milk\n@/todo eggs", 100),
    message("m2", "t2", "- [ ] call the bank", 200),
    message("m3", "t2", "nothing to do here", 300),
  ];
  const todos = asLines(collectTodos(threads, messages));
  expect(todos.map((t) => t.text)).toEqual(["- [ ] call the bank", "- [ ] milk", "@/todo eggs"]);
  expect(todos[0]).toMatchObject({ threadId: "t2", threadTitle: "Errands", messageId: "m2", done: false });
  const ids = todos.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length); // two todos from the same message still get distinct ids
});

test("collectTodos returns both open and closed todos, each carrying done and enough to edit back", () => {
  const threads = [thread("t1", "Groceries")];
  const messages = [message("m1", "t1", "@/todo milk\n~~@/todo eggs~~", 100)];
  const todos = asLines(collectTodos(threads, messages));
  expect(todos.map((t) => t.done)).toEqual([false, true]);
  expect(todos.every((t) => t.messageContent === messages[0]?.content)).toBe(true);
  expect(todos.map((t) => t.lineIndex)).toEqual([0, 1]);
});

// --- @/todos grouped lists (backlog.md "Grouped todo lists + convert-a-message action") ---

test("parseTodoGroups: a trigger followed by list items becomes one group, marker stripped", () => {
  const content = "@/todos Groceries\n- milk\n- [x] eggs\n- [ ] bread";
  const { groups } = parseTodoGroups(content);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ title: "Groceries", titleLineIndex: 0 });
  expect(groups[0]?.items).toEqual([
    { text: "milk", done: false, lineIndex: 1 },
    { text: "eggs", done: true, lineIndex: 2 },
    { text: "bread", done: false, lineIndex: 3 },
  ]);
});

test("parseTodoGroups stops at the first blank line", () => {
  const content = "@/todos List\n- one\n- two\n\n- not in the group";
  const { groups } = parseTodoGroups(content);
  expect(groups[0]?.items.map((i) => i.text)).toEqual(["one", "two"]);
});

test("parseTodoGroups stops at the first line that isn't a list item", () => {
  const content = "@/todos List\n- one\nsome prose resumes here\n- two (not counted)";
  const { groups } = parseTodoGroups(content);
  expect(groups[0]?.items.map((i) => i.text)).toEqual(["one"]);
});

test("a trigger with nothing under it isn't a group", () => {
  expect(parseTodoGroups("@/todos Empty\nnot a list item").groups).toEqual([]);
});

test("a plain `- item` (no checkbox) parses open; a mixed run keeps each item's own state", () => {
  const { groups } = parseTodoGroups("@/todos Mixed\n- plain open\n- [x] done\n- [ ] open with box");
  expect(groups[0]?.items.map((i) => [i.text, i.done])).toEqual([
    ["plain open", false],
    ["done", true],
    ["open with box", false],
  ]);
});

test("parseTodos excludes lines a @/todos group already consumed, so a group item isn't also a flat todo", () => {
  const content = "@/todos Groceries\n- [ ] milk\n- [x] eggs\n\n@/todo separate one";
  expect(parseTodos(content)).toEqual([{ text: "@/todo separate one", done: false, lineIndex: 4 }]);
});

test("toggleTodoLine on a plain list item (no checkbox) ADDS the checkbox syntax", () => {
  expect(toggleTodoLine("- buy milk", 0)).toBe("- [x] buy milk");
  expect(toggleTodoLine("* buy milk", 0)).toBe("* [x] buy milk");
});

test("collectTodos surfaces a @/todos group as one entry carrying its items", () => {
  const threads = [thread("t1", "List")];
  const messages = [message("m1", "t1", "@/todos Groceries\n- milk\n- [x] eggs", 100)];
  const todos = collectTodos(threads, messages);
  expect(todos).toHaveLength(1);
  const group = todos[0]!;
  if (group.kind !== "group") throw new Error("expected a group todo");
  expect(group.title).toBe("Groceries");
  expect(group.items.map((i) => [i.text, i.done])).toEqual([
    ["milk", false],
    ["eggs", true],
  ]);
});

// --- message-level "Add to Todos" flag (meta.todo, not text) ---

test("collectTodos surfaces a message flagged via meta.todo as its own entry, independent of its text", () => {
  const threads = [thread("t1", "Notes")];
  const messages = [
    message("m1", "t1", "plain note, no todo syntax at all", 100, { todo: { done: false } }),
    message("m2", "t1", "closed one", 200, { todo: { done: true } }),
    message("m3", "t1", "not flagged", 300),
  ];
  const todos = collectTodos(threads, messages);
  expect(todos).toHaveLength(2);
  expect(todos.map((t) => (t.kind === "message" ? [t.messageId, t.done, t.messageContent] : null))).toEqual([
    ["m2", true, "closed one"],
    ["m1", false, "plain note, no todo syntax at all"],
  ]);
});

// --- closed-at derivation + the "recent" filter window (backlog.md "Closed-todo filter") ---

test("a LineTodo's closedAt approximates via the message's editedAt, falling back to createdAt", () => {
  const threads = [thread("t1", "List")];
  const untouched = message("m1", "t1", "~~@/todo milk~~", 100);
  const edited = message("m2", "t1", "~~@/todo eggs~~", 100, null, { editedAt: 250 });
  const todos = asLines(collectTodos(threads, [untouched, edited]));
  expect(todos.find((t) => t.messageId === "m1")?.closedAt).toBe(100);
  expect(todos.find((t) => t.messageId === "m2")?.closedAt).toBe(250);
});

test("a MessageTodo's closedAt is exact — the message's metaEditedAt, falling back to createdAt", () => {
  const threads = [thread("t1", "Notes")];
  const untouched = message("m1", "t1", "no meta edit yet", 100, { todo: { done: true } });
  const edited = message("m2", "t1", "flagged then flipped", 100, { todo: { done: true } }, { metaEditedAt: 300 });
  const todos = collectTodos(threads, [untouched, edited]);
  const closedAtOf = (id: string) => {
    const t = todos.find((t) => t.messageId === id);
    if (t?.kind !== "message") throw new Error("expected a message todo");
    return t.closedAt;
  };
  expect(closedAtOf("m1")).toBe(100);
  expect(closedAtOf("m2")).toBe(300);
});

test("isTodoVisible: a group and its items are never filtered, open or closed", () => {
  const group: Todo = {
    kind: "group",
    id: "g1",
    threadId: "t1",
    threadTitle: "List",
    messageId: "m1",
    messageContent: "@/todos List\n- [x] eggs",
    title: "List",
    items: [{ text: "eggs", done: true, lineIndex: 1 }],
    createdAt: 0,
  };
  expect(isTodoVisible(group, "never", 1_000_000)).toBe(true);
  expect(isTodoVisible(group, "always", 1_000_000)).toBe(true);
  expect(isTodoVisible(group, "recent", 1_000_000)).toBe(true);
});

test("isTodoVisible: an open flat todo is always visible regardless of filter", () => {
  const openLine: LineTodo = {
    kind: "line",
    id: "l1",
    threadId: "t1",
    threadTitle: "List",
    messageId: "m1",
    messageContent: "@/todo milk",
    lineIndex: 0,
    text: "@/todo milk",
    done: false,
    createdAt: 0,
    closedAt: 0,
  };
  expect(isTodoVisible(openLine, "never", 1_000_000)).toBe(true);
});

test("isTodoVisible: 'always'/'never' ignore the closed-at timestamp entirely", () => {
  const closedLine: LineTodo = {
    kind: "line",
    id: "l1",
    threadId: "t1",
    threadTitle: "List",
    messageId: "m1",
    messageContent: "~~@/todo milk~~",
    lineIndex: 0,
    text: "~~@/todo milk~~",
    done: true,
    createdAt: 0,
    closedAt: 0,
  };
  expect(isTodoVisible(closedLine, "always", 1_000_000)).toBe(true);
  expect(isTodoVisible(closedLine, "never", 1_000_000)).toBe(false);
});

test("isTodoVisible: 'recent' — visible just inside the 24h window, hidden just outside it", () => {
  const closedAt = 10_000;
  const closedLine: LineTodo = {
    kind: "line",
    id: "l1",
    threadId: "t1",
    threadTitle: "List",
    messageId: "m1",
    messageContent: "~~@/todo milk~~",
    lineIndex: 0,
    text: "~~@/todo milk~~",
    done: true,
    createdAt: closedAt,
    closedAt,
  };
  expect(isTodoVisible(closedLine, "recent", closedAt + RECENT_CLOSED_MS - 1)).toBe(true);
  expect(isTodoVisible(closedLine, "recent", closedAt + RECENT_CLOSED_MS + 1)).toBe(false);
});

// --- bare `/` prefix (the `@/` form above stays supported for notes written before the change) ---

test("/todo and /todos parse like their @/ forms, mid-sentence still doesn't match", () => {
  expect(parseTodos("/todo write more docs")).toEqual([{ text: "/todo write more docs", done: false, lineIndex: 0 }]);
  expect(parseTodos("~~/todo write more docs~~")).toEqual([
    { text: "~~/todo write more docs~~", done: true, lineIndex: 0 },
  ]);
  expect(parseTodos("see /todo below")).toEqual([]);
  expect(parseTodos("/todos-like path")).toEqual([]);
  expect(parseTodoGroups("/todos Groceries\n- milk").groups).toEqual([
    { title: "Groceries", titleLineIndex: 0, items: [{ text: "milk", done: false, lineIndex: 1 }] },
  ]);
});

test("toggleTodoLine and stripTodoMarker keep whichever prefix the line was written with", () => {
  expect(toggleTodoLine("/todo call mom", 0)).toBe("~~/todo call mom~~");
  expect(toggleTodoLine("~~/todo call mom~~", 0)).toBe("/todo call mom");
  expect(toggleTodoLine("@/todo call mom", 0)).toBe("~~@/todo call mom~~");
  expect(stripTodoMarker("/todo call mom")).toBe("call mom");
  expect(stripTodoMarker("~~/todo call mom~~")).toBe("call mom");
});

import { expect, test } from "bun:test";
import { collectTodos, parseTodos, stripTodoMarker, toggleTodoLine } from "./todos";
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

const message = (id: string, threadId: string, content: string, createdAt: number): Message => ({
  id,
  threadId,
  role: "user",
  content,
  createdAt,
  seq: 1,
  meta: null,
});

test("collectTodos scans every thread's messages, newest first, and skips threads/messages with none", () => {
  const threads = [thread("t1", "Groceries"), thread("t2", "Errands")];
  const messages = [
    message("m1", "t1", "- [ ] milk\n@/todo eggs", 100),
    message("m2", "t2", "- [ ] call the bank", 200),
    message("m3", "t2", "nothing to do here", 300),
  ];
  const todos = collectTodos(threads, messages);
  expect(todos.map((t) => t.text)).toEqual(["- [ ] call the bank", "- [ ] milk", "@/todo eggs"]);
  expect(todos[0]).toMatchObject({ threadId: "t2", threadTitle: "Errands", messageId: "m2", done: false });
  const ids = todos.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length); // two todos from the same message still get distinct ids
});

test("collectTodos returns both open and closed todos, each carrying done and enough to edit back", () => {
  const threads = [thread("t1", "Groceries")];
  const messages = [message("m1", "t1", "@/todo milk\n~~@/todo eggs~~", 100)];
  const todos = collectTodos(threads, messages);
  expect(todos.map((t) => t.done)).toEqual([false, true]);
  expect(todos.every((t) => t.messageContent === messages[0]?.content)).toBe(true);
  expect(todos.map((t) => t.lineIndex)).toEqual([0, 1]);
});

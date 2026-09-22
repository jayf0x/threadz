import { expect, test } from "bun:test";
import { collectOpenTodos, parseOpenTodos, stripTodoMarker } from "./todos";
import type { Message, Thread } from "./types";

test("matches a plain unchecked line", () => {
  expect(parseOpenTodos("- [ ] buy milk")).toEqual(["- [ ] buy milk"]);
});

test("a checked box never matches", () => {
  expect(parseOpenTodos("- [x] already done")).toEqual([]);
  expect(parseOpenTodos("- [X] also done")).toEqual([]);
});

test("indented / nested list items still match", () => {
  expect(parseOpenTodos("  - [ ] sub item")).toEqual(["- [ ] sub item"]);
  expect(parseOpenTodos("    - [ ] deeper still")).toEqual(["- [ ] deeper still"]);
});

test("the literal text mid-sentence still matches (false positives are cheap here)", () => {
  expect(parseOpenTodos("I typed - [ ] in the middle of a sentence")).toEqual([
    "I typed - [ ] in the middle of a sentence",
  ]);
});

test("multiple todos in one message each come back as their own line", () => {
  const content = "Groceries:\n- [ ] milk\n- [x] eggs (done)\n- [ ] bread\nnot a todo line";
  expect(parseOpenTodos(content)).toEqual(["- [ ] milk", "- [ ] bread"]);
});

test("no todos in a message with none", () => {
  expect(parseOpenTodos("just a plain note, nothing checkable")).toEqual([]);
});

test("stripTodoMarker drops the checkbox, keeps the rest", () => {
  expect(stripTodoMarker("- [ ] call mom")).toBe("call mom");
  expect(stripTodoMarker("-[] no spaces")).toBe("no spaces");
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

test("collectOpenTodos scans every thread's messages, newest first, and skips threads/messages with none", () => {
  const threads = [thread("t1", "Groceries"), thread("t2", "Errands")];
  const messages = [
    message("m1", "t1", "- [ ] milk\n- [ ] eggs", 100),
    message("m2", "t2", "- [ ] call the bank", 200),
    message("m3", "t2", "nothing to do here", 300),
  ];
  const todos = collectOpenTodos(threads, messages);
  expect(todos.map((t) => t.text)).toEqual(["- [ ] call the bank", "- [ ] milk", "- [ ] eggs"]);
  expect(todos[0]).toMatchObject({ threadId: "t2", threadTitle: "Errands", messageId: "m2" });
  const ids = todos.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length); // two todos from the same message still get distinct ids
});

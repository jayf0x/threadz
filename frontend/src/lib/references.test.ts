import { expect, test } from "bun:test";
import {
  buildReferenceHref,
  completeMessage,
  completeThread,
  findReferences,
  messageSnippet,
  nextAutocompleteState,
  parseReferenceHref,
  resolveMessageRange,
  searchMessages,
  searchThreads,
} from "./references";
import type { Message, Thread } from "./types";

// --- format ------------------------------------------------------------------

test("buildReferenceHref: thread-only vs thread+message", () => {
  expect(buildReferenceHref("t1")).toBe("thread=t1");
  expect(buildReferenceHref("t1", null)).toBe("thread=t1");
  expect(buildReferenceHref("t1", "m1")).toBe("thread=t1?message=m1");
});

test("parseReferenceHref round-trips buildReferenceHref", () => {
  expect(parseReferenceHref(buildReferenceHref("t1"))).toEqual({ threadId: "t1", messageId: null });
  expect(parseReferenceHref(buildReferenceHref("t1", "m1"))).toEqual({ threadId: "t1", messageId: "m1" });
});

test("parseReferenceHref rejects anything that isn't our shape", () => {
  expect(parseReferenceHref(null)).toBeNull();
  expect(parseReferenceHref(undefined)).toBeNull();
  expect(parseReferenceHref("")).toBeNull();
  expect(parseReferenceHref("https://example.com")).toBeNull();
  expect(parseReferenceHref("link:t1/m1")).toBeNull(); // the other floated (and rejected) spelling
  expect(parseReferenceHref("thread=")).toBeNull();
});

test("findReferences finds every completed reference in order, ignoring ordinary links", () => {
  const content = [
    "see [Groceries](thread=t1) and also [Groceries § milk](thread=t1?message=m1)",
    "but not [a real link](https://example.com) or [broken](thread=)",
  ].join("\n");
  const found = findReferences(content);
  expect(found).toHaveLength(2);
  expect(found[0]).toMatchObject({ text: "Groceries", threadId: "t1", messageId: null });
  expect(found[1]).toMatchObject({ text: "Groceries § milk", threadId: "t1", messageId: "m1" });
  // start/end bracket exactly the matched substring
  const first = found[0];
  if (!first) throw new Error("expected a match");
  expect(content.slice(first.start, first.end)).toBe("[Groceries](thread=t1)");
});

test("findReferences returns nothing for plain text", () => {
  expect(findReferences("just some notes, no links here")).toEqual([]);
  expect(findReferences("[a link](https://example.com)")).toEqual([]);
});

// --- the two-stage state machine ---------------------------------------------

test("typing the trigger opens the thread stage and tracks the query", () => {
  let state = nextAutocompleteState({ stage: "closed" }, "hello [[", 8);
  expect(state).toEqual({ stage: "thread", anchor: 6, query: "" });
  state = nextAutocompleteState(state, "hello [[pro", 11);
  expect(state).toEqual({ stage: "thread", anchor: 6, query: "pro" });
});

test("deleting back past the trigger closes the stage", () => {
  const opened = nextAutocompleteState({ stage: "closed" }, "hi [[pro", 8);
  expect(opened.stage).toBe("thread");
  const closed = nextAutocompleteState(opened, "hi [", 4);
  expect(closed).toEqual({ stage: "closed" });
});

test("moving the caret away from an unrelated later [[ starts a fresh session, not a continuation", () => {
  const first = nextAutocompleteState({ stage: "closed" }, "[[abc", 5);
  expect(first).toEqual({ stage: "thread", anchor: 0, query: "abc" });
  // caret jumps to a second, later trigger — different anchor, so this is NOT "the same session"
  const second = nextAutocompleteState(first, "[[abc]] and [[xyz", 17);
  expect(second).toEqual({ stage: "thread", anchor: 12, query: "xyz" });
});

test("no trigger in sight: stays closed", () => {
  expect(nextAutocompleteState({ stage: "closed" }, "just typing along", 6)).toEqual({ stage: "closed" });
});

test("completeThread inserts a closed, valid link and continues into the message stage", () => {
  const state = { stage: "thread" as const, anchor: 6, query: "Groc" };
  const thread: Thread = {
    id: "t1",
    title: "Groceries",
    createdAt: 0,
    updatedAt: 0,
    description: null,
    tags: [],
    hasEmbedding: false,
  };
  const { edit, next } = completeThread(state, thread);
  expect(edit).toEqual({ from: 6, to: 6 + 2 + 4, text: "[Groceries](thread=t1)" });
  expect(next).toEqual({
    stage: "message",
    anchor: 6,
    linkEnd: 6 + "[Groceries](thread=t1)".length,
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  });
});

test("typing right after a thread-only link continues the message-stage query", () => {
  const afterThread = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 22, // "[Groceries](thread=t1)".length
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  };
  const typed = nextAutocompleteState(afterThread, "[Groceries](thread=t1) mil", 27);
  expect(typed).toEqual({ ...afterThread, query: " mil" });
});

test("typing a newline or a bracket after the link ends the message stage", () => {
  const afterThread = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 22,
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  };
  expect(nextAutocompleteState(afterThread, "[Groceries](thread=t1)\nnext line", 28)).toEqual({ stage: "closed" });
  expect(nextAutocompleteState(afterThread, "[Groceries](thread=t1) [[new", 29)).toEqual({ stage: "closed" });
});

test("esc/outside-click (the caller just resets to closed) leaves a thread-only reference behind untouched", () => {
  // Nothing in this module deletes text on cancel — the caller only ever sets
  // { stage: "closed" }, and completeThread already inserted a complete, valid link, so "leave a
  // thread-only reference behind" falls out for free: there is no further edit to make or undo.
  const state = nextAutocompleteState(
    { stage: "message", anchor: 0, linkEnd: 22, threadId: "t1", displayText: "Groceries", query: "" },
    "[Groceries](thread=t1)",
    22,
  );
  const cancelled: typeof state = { stage: "closed" };
  expect(cancelled).toEqual({ stage: "closed" });
  expect(findReferences("[Groceries](thread=t1)")).toEqual([
    { text: "Groceries", href: "thread=t1", threadId: "t1", messageId: null, start: 0, end: 22 },
  ]);
});

test("completeMessage folds the message id into the existing link and preserves its display text", () => {
  const state = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 22,
    threadId: "t1",
    displayText: "Groceries", // unchanged even though the user typed "milk" to search for it
    query: " milk",
  };
  const { edit, next, href } = completeMessage(state, { id: "m1" });
  expect(edit).toEqual({ from: 0, to: 27, text: "[Groceries](thread=t1?message=m1)" });
  expect(href).toBe("thread=t1?message=m1");
  // Not closed: the same popup now offers the (optional) end of a range, starting from m1.
  expect(next).toEqual({ ...state, linkEnd: 33, from: "m1", query: "" });
});

// --- ranges --------------------------------------------------------------------

test("a range href round-trips, and a degenerate one collapses to a single message", () => {
  expect(buildReferenceHref("t1", "m1", "m2")).toBe("thread=t1?message=m1..m2");
  expect(parseReferenceHref("thread=t1?message=m1..m2")).toEqual({
    threadId: "t1",
    messageId: "m1",
    toMessageId: "m2",
  });
  expect(buildReferenceHref("t1", "m1", "m1")).toBe("thread=t1?message=m1");
  expect(buildReferenceHref("t1", null, "m2")).toBe("thread=t1");
  // UUID-shaped ids (hyphens) split cleanly on `..`
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  expect(parseReferenceHref(buildReferenceHref("t1", a, b))).toEqual({ threadId: "t1", messageId: a, toMessageId: b });
  expect(parseReferenceHref("thread=t1?message=m1..")).toEqual({ threadId: "t1", messageId: "m1" }); // dangling `..`
});

test("findReferences reads a range link", () => {
  const [ref] = findReferences("see [Groceries](thread=t1?message=m1..m2)");
  expect(ref).toMatchObject({ threadId: "t1", messageId: "m1", toMessageId: "m2" });
});

test("resolveMessageRange covers everything between the endpoints, in whatever order they're shown", () => {
  const ids = (xs: { id: string }[]) => xs.map((m) => m.id);
  const chrono = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const newestFirst = [...chrono].reverse();
  expect(ids(resolveMessageRange(chrono, "b..d"))).toEqual(["b", "c", "d"]);
  expect(ids(resolveMessageRange(newestFirst, "b..d"))).toEqual(["d", "c", "b"]); // topmost row first
  expect(ids(resolveMessageRange(chrono, "d..b"))).toEqual(["b", "c", "d"]); // picked backwards
  expect(ids(resolveMessageRange(chrono, "c"))).toEqual(["c"]);
  expect(ids(resolveMessageRange(chrono, "c..zzz"))).toEqual(["c"]); // an endpoint that's gone degrades
  expect(ids(resolveMessageRange(chrono, "zzz..c"))).toEqual(["c"]);
  expect(resolveMessageRange(chrono, "zzz")).toEqual([]);
  expect(resolveMessageRange(chrono, null)).toEqual([]);
});

test("the second pick of completeMessage closes the autocomplete with a range link; the same message again stays single", () => {
  const picked = completeMessage(
    { stage: "message", anchor: 0, linkEnd: 22, threadId: "t1", displayText: "Groceries", query: "" },
    { id: "m1" },
  ).next;
  if (picked.stage !== "message") throw new Error("expected the range pick stage");
  // The user types a query for the end message first: the whole "[…](…?message=m1) query" is replaced.
  const typed = nextAutocompleteState(picked, "[Groceries](thread=t1?message=m1) oat", 37);
  if (typed.stage !== "message") throw new Error("expected to stay in the message stage");
  const range = completeMessage(typed, { id: "m3" });
  expect(range.edit).toEqual({ from: 0, to: 37, text: "[Groceries](thread=t1?message=m1..m3)" });
  expect(range.href).toBe("thread=t1?message=m1..m3");
  expect(range.next).toEqual({ stage: "closed" });
  expect(completeMessage(picked, { id: "m1" }).href).toBe("thread=t1?message=m1");
});

// --- local search --------------------------------------------------------------

const thread = (over: Partial<Thread>): Thread => ({
  id: "t",
  title: "",
  createdAt: 0,
  updatedAt: 0,
  description: null,
  tags: [],
  hasEmbedding: false,
  ...over,
});

const message = (over: Partial<Message>): Message => ({
  id: "m",
  threadId: "t1",
  role: "user",
  content: "",
  createdAt: 0,
  seq: 1,
  meta: null,
  ...over,
});

test("searchThreads ranks title matches and falls back to recency when the query is empty", () => {
  const threads = [
    thread({ id: "a", title: "Groceries", updatedAt: 1 }),
    thread({ id: "b", title: "Grocery run notes", updatedAt: 3 }),
    thread({ id: "c", title: "Unrelated", updatedAt: 2 }),
  ];
  expect(searchThreads(threads, "groc").map((t) => t.id)).toEqual(["a", "b"]);
  expect(searchThreads(threads, "").map((t) => t.id)).toEqual(["b", "c", "a"]); // newest first
  expect(searchThreads(threads, "zzz")).toEqual([]);
});

test("searchMessages is scoped to one thread and ranks content matches", () => {
  const messages = [
    message({ id: "m1", threadId: "t1", content: "buy milk", createdAt: 1 }),
    message({ id: "m2", threadId: "t1", content: "call the dentist", createdAt: 2 }),
    message({ id: "m3", threadId: "t2", content: "buy milk too", createdAt: 3 }), // different thread
  ];
  expect(searchMessages(messages, "t1", "milk").map((m) => m.id)).toEqual(["m1"]);
  expect(searchMessages(messages, "t1", "").map((m) => m.id)).toEqual(["m2", "m1"]); // newest first
  expect(searchMessages(messages, "t1", "", 8, "m1").map((m) => m.id)).toEqual(["m1", "m2"]); // pinned first
});

test("messageSnippet flattens the first non-blank line and drops image refs / markdown noise", () => {
  expect(messageSnippet("\n\n**hello** world")).toBe("hello world");
  expect(messageSnippet("![](img:abc#10x10)\nsecond line")).toBe("a photo");
  expect(messageSnippet("- a bullet")).toBe("- a bullet");
});

import { expect, test } from "bun:test";
import {
  buildLinkReferenceHref,
  buildNoteReferenceHref,
  buildPropertySetReferenceHref,
  buildReferenceHref,
  completeMessage,
  completeSimpleReference,
  completeThread,
  findReferences,
  isReferenceHref,
  messageSnippet,
  nextAutocompleteState,
  parseReferenceHref,
  resolveMessageRange,
  searchLinks,
  searchMessages,
  searchNotes,
  searchPropertySets,
  searchThreads,
} from "./references";
import type { Message, Thread } from "./types";

// --- format ------------------------------------------------------------------

test("buildReferenceHref: thread-only vs thread+message", () => {
  expect(buildReferenceHref("t1")).toBe("tz:thread/t1");
  expect(buildReferenceHref("t1", null)).toBe("tz:thread/t1");
  expect(buildReferenceHref("t1", "m1")).toBe("tz:message/t1/m1");
});

test("parseReferenceHref round-trips buildReferenceHref", () => {
  expect(parseReferenceHref(buildReferenceHref("t1"))).toEqual({ threadId: "t1", messageId: null });
  expect(parseReferenceHref(buildReferenceHref("t1", "m1"))).toEqual({ threadId: "t1", messageId: "m1" });
});

test("parseReferenceHref reads a pinned reference's version, even though nothing writes one yet", () => {
  expect(parseReferenceHref("tz:thread/t1@3")).toEqual({ threadId: "t1", messageId: null, version: "3" });
  expect(parseReferenceHref("tz:message/t1/m1@7")).toEqual({ threadId: "t1", messageId: "m1", version: "7" });
});

test("parseReferenceHref rejects anything that isn't our shape", () => {
  expect(parseReferenceHref(null)).toBeNull();
  expect(parseReferenceHref(undefined)).toBeNull();
  expect(parseReferenceHref("")).toBeNull();
  expect(parseReferenceHref("https://example.com")).toBeNull();
  expect(parseReferenceHref("link:t1/m1")).toBeNull(); // an earlier floated (and rejected) spelling
  expect(parseReferenceHref("thread=t1")).toBeNull(); // the v1 spelling this grammar replaces
  expect(parseReferenceHref("tz:thread/")).toBeNull();
  expect(parseReferenceHref("tz:message/t1")).toBeNull(); // missing the message segment
});

test("isReferenceHref tells a tz: reference apart from any other href", () => {
  expect(isReferenceHref("tz:thread/t1")).toBe(true);
  expect(isReferenceHref("https://example.com")).toBe(false);
  expect(isReferenceHref(null)).toBe(false);
  expect(isReferenceHref(undefined)).toBe(false);
});

test("findReferences finds every completed reference in order, ignoring ordinary links", () => {
  const content = [
    "see [Groceries](tz:thread/t1) and also [Groceries § milk](tz:message/t1/m1)",
    "but not [a real link](https://example.com) or [broken](tz:thread/)",
  ].join("\n");
  const found = findReferences(content);
  expect(found).toHaveLength(2);
  expect(found[0]).toMatchObject({ text: "Groceries", threadId: "t1", messageId: null });
  expect(found[1]).toMatchObject({ text: "Groceries § milk", threadId: "t1", messageId: "m1" });
  // start/end bracket exactly the matched substring
  const first = found[0];
  if (!first) throw new Error("expected a match");
  expect(content.slice(first.start, first.end)).toBe("[Groceries](tz:thread/t1)");
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
  };
  const { edit, next } = completeThread(state, thread);
  expect(edit).toEqual({ from: 6, to: 6 + 2 + 4, text: "[Groceries](tz:thread/t1)" });
  expect(next).toEqual({
    stage: "message",
    anchor: 6,
    linkEnd: 6 + "[Groceries](tz:thread/t1)".length,
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  });
});

test("typing right after a thread-only link continues the message-stage query", () => {
  const afterThread = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 25, // "[Groceries](tz:thread/t1)".length
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  };
  const text = "[Groceries](tz:thread/t1) mil";
  const typed = nextAutocompleteState(afterThread, text, text.length);
  expect(typed).toEqual({ ...afterThread, query: " mil" });
});

test("typing a newline or a bracket after the link ends the message stage", () => {
  const afterThread = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 25,
    threadId: "t1",
    displayText: "Groceries",
    query: "",
  };
  const withNewline = "[Groceries](tz:thread/t1)\nnext line";
  expect(nextAutocompleteState(afterThread, withNewline, withNewline.length)).toEqual({ stage: "closed" });
  const withBracket = "[Groceries](tz:thread/t1) [[new";
  expect(nextAutocompleteState(afterThread, withBracket, withBracket.length)).toEqual({ stage: "closed" });
});

test("esc/outside-click (the caller just resets to closed) leaves a thread-only reference behind untouched", () => {
  // Nothing in this module deletes text on cancel — the caller only ever sets
  // { stage: "closed" }, and completeThread already inserted a complete, valid link, so "leave a
  // thread-only reference behind" falls out for free: there is no further edit to make or undo.
  const state = nextAutocompleteState(
    { stage: "message", anchor: 0, linkEnd: 25, threadId: "t1", displayText: "Groceries", query: "" },
    "[Groceries](tz:thread/t1)",
    25,
  );
  const cancelled: typeof state = { stage: "closed" };
  expect(cancelled).toEqual({ stage: "closed" });
  expect(findReferences("[Groceries](tz:thread/t1)")).toEqual([
    { text: "Groceries", href: "tz:thread/t1", threadId: "t1", messageId: null, start: 0, end: 25 },
  ]);
});

test("completeMessage folds the message id into the existing link and preserves its display text", () => {
  const state = {
    stage: "message" as const,
    anchor: 0,
    linkEnd: 25,
    threadId: "t1",
    displayText: "Groceries", // unchanged even though the user typed "milk" to search for it
    query: " milk",
  };
  const { edit, next, href } = completeMessage(state, { id: "m1" });
  expect(edit).toEqual({ from: 0, to: 30, text: "[Groceries](tz:message/t1/m1)" });
  expect(href).toBe("tz:message/t1/m1");
  // Not closed: the same popup now offers the (optional) end of a range, starting from m1.
  expect(next).toEqual({ ...state, linkEnd: 29, from: "m1", query: "" });
});

// --- ranges --------------------------------------------------------------------

test("a range href round-trips, and a degenerate one collapses to a single message", () => {
  expect(buildReferenceHref("t1", "m1", "m2")).toBe("tz:message/t1/m1..m2");
  expect(parseReferenceHref("tz:message/t1/m1..m2")).toEqual({
    threadId: "t1",
    messageId: "m1",
    toMessageId: "m2",
  });
  expect(buildReferenceHref("t1", "m1", "m1")).toBe("tz:message/t1/m1");
  expect(buildReferenceHref("t1", null, "m2")).toBe("tz:thread/t1");
  // UUID-shaped ids (hyphens) split cleanly on `..`
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  expect(parseReferenceHref(buildReferenceHref("t1", a, b))).toEqual({ threadId: "t1", messageId: a, toMessageId: b });
  expect(parseReferenceHref("tz:message/t1/m1..")).toEqual({ threadId: "t1", messageId: "m1" }); // dangling `..`
});

test("findReferences reads a range link", () => {
  const [ref] = findReferences("see [Groceries](tz:message/t1/m1..m2)");
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
    { stage: "message", anchor: 0, linkEnd: 25, threadId: "t1", displayText: "Groceries", query: "" },
    { id: "m1" },
  ).next;
  if (picked.stage !== "message") throw new Error("expected the range pick stage");
  // The user types a query for the end message first: the whole "[…](…/m1) query" is replaced.
  const queried = "[Groceries](tz:message/t1/m1) oat";
  const typed = nextAutocompleteState(picked, queried, queried.length);
  if (typed.stage !== "message") throw new Error("expected to stay in the message stage");
  const range = completeMessage(typed, { id: "m3" });
  expect(range.edit).toEqual({ from: 0, to: queried.length, text: "[Groceries](tz:message/t1/m1..m3)" });
  expect(range.href).toBe("tz:message/t1/m1..m3");
  expect(range.next).toEqual({ stage: "closed" });
  expect(completeMessage(picked, { id: "m1" }).href).toBe("tz:message/t1/m1");
});

// --- local search --------------------------------------------------------------

const thread = (over: Partial<Thread>): Thread => ({
  id: "t",
  title: "",
  createdAt: 0,
  updatedAt: 0,
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

// --- new reference kinds: note, link, property_set (wave 6 phase 2) ------------------------

test("buildNoteReferenceHref: live vs pinned", () => {
  expect(buildNoteReferenceHref("n1")).toBe("tz:note/n1");
  expect(buildNoteReferenceHref("n1", null)).toBe("tz:note/n1");
  expect(buildNoteReferenceHref("n1", "v3")).toBe("tz:note/n1@v3");
});

test("buildLinkReferenceHref / buildPropertySetReferenceHref: flat ids, never pinned", () => {
  expect(buildLinkReferenceHref("l1")).toBe("tz:link/l1");
  expect(buildPropertySetReferenceHref("ps1")).toBe("tz:property_set/ps1");
});

test("parseReferenceHref round-trips the note/link/property_set kinds", () => {
  expect(parseReferenceHref(buildNoteReferenceHref("n1"))).toEqual({ kind: "note", id: "n1" });
  expect(parseReferenceHref(buildNoteReferenceHref("n1", "v3"))).toEqual({ kind: "note", id: "n1", version: "v3" });
  expect(parseReferenceHref(buildLinkReferenceHref("l1"))).toEqual({ kind: "link", id: "l1" });
  expect(parseReferenceHref(buildPropertySetReferenceHref("ps1"))).toEqual({ kind: "property_set", id: "ps1" });
});

test("parseReferenceHref still rejects malformed note/link/property_set hrefs", () => {
  expect(parseReferenceHref("tz:note/")).toBeNull();
  expect(parseReferenceHref("tz:link/")).toBeNull();
  expect(parseReferenceHref("tz:property_set/")).toBeNull();
  expect(parseReferenceHref("tz:widget/x1")).toBeNull(); // not a real kind
});

test("findReferences picks up note/link/property_set links alongside thread/message ones", () => {
  const content = [
    "see [an idea](tz:note/n1) and [an idea, pinned](tz:note/n1@v3)",
    "also [some link](tz:link/l1) and [a set](tz:property_set/ps1)",
  ].join("\n");
  const found = findReferences(content);
  expect(found).toHaveLength(4);
  expect(found[0]).toMatchObject({ text: "an idea", kind: "note", id: "n1" });
  expect(found[1]).toMatchObject({ text: "an idea, pinned", kind: "note", id: "n1", version: "v3" });
  expect(found[2]).toMatchObject({ text: "some link", kind: "link", id: "l1" });
  expect(found[3]).toMatchObject({ text: "a set", kind: "property_set", id: "ps1" });
});

test("completeSimpleReference inserts a closed link and closes the autocomplete (no second stage)", () => {
  const state = { stage: "thread" as const, anchor: 6, query: "idea" };
  const { edit, next } = completeSimpleReference(state, "An idea", "tz:note/n1");
  expect(edit).toEqual({ from: 6, to: 6 + 2 + 4, text: "[An idea](tz:note/n1)" });
  expect(next).toEqual({ stage: "closed" });
});

const noteCandidate = (over: Partial<{ entityId: string; content: string; createdAt: number }>) => ({
  entityId: "n",
  content: "",
  createdAt: 0,
  ...over,
});

test("searchNotes ranks content matches and falls back to newest-first when empty", () => {
  const notes = [
    noteCandidate({ entityId: "a", content: "pack for winter", createdAt: 1 }),
    noteCandidate({ entityId: "b", content: "winter is coming", createdAt: 3 }),
    noteCandidate({ entityId: "c", content: "unrelated", createdAt: 2 }),
  ];
  expect(searchNotes(notes, "winter").map((n) => n.entityId)).toEqual(["b", "a"]);
  expect(searchNotes(notes, "").map((n) => n.entityId)).toEqual(["b", "c", "a"]);
  expect(searchNotes(notes, "zzz")).toEqual([]);
});

test("searchNotes offers a note once even if it comes in twice", () => {
  const notes = [noteCandidate({ entityId: "a", createdAt: 1 }), noteCandidate({ entityId: "a", createdAt: 1 })];
  expect(searchNotes(notes, "")).toHaveLength(1);
});

test("searchPropertySets leaves out the built-in sets", () => {
  const sets = [
    { id: "ps-attached", name: "Attached" },
    { id: "ps-local-only", name: "Local only" },
    { id: "x", name: "Mood" },
  ];
  expect(searchPropertySets(sets, "").map((s) => s.id)).toEqual(["x"]);
  expect(searchPropertySets(sets, "att")).toEqual([]);
});

test("searchLinks ranks label matches and keeps recency order when empty", () => {
  const links = [
    { id: "a", label: "reference" },
    { id: "b", label: "Link" },
    { id: "c", label: "citation" },
  ];
  expect(searchLinks(links, "cit").map((l) => l.id)).toEqual(["c"]);
  expect(searchLinks(links, "").map((l) => l.id)).toEqual(["a", "b", "c"]); // already newest-first
});

test("searchPropertySets ranks name matches and keeps input order when empty", () => {
  const sets = [
    { id: "a", name: "Chapter" },
    { id: "b", name: "Character" },
  ];
  expect(searchPropertySets(sets, "chap").map((s) => s.id)).toEqual(["a"]);
  expect(searchPropertySets(sets, "").map((s) => s.id)).toEqual(["a", "b"]);
  expect(searchPropertySets(sets, "zzz")).toEqual([]);
});

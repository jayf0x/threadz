import { expect, test } from "bun:test";
import type { Message, Thread } from "@/lib/types";
import { autoTitle, nextTitle, noteText, titleFrom } from "./titles";

const thread = (title: string): Thread => ({
  id: "t",
  title,
  createdAt: 1,
  updatedAt: 1,
  renamedAt: null,
  description: null,
  tags: [],
  hasEmbedding: false,
});

const note = (content: string, role: Message["role"] = "user"): Message => ({
  id: content,
  threadId: "t",
  role,
  content,
  createdAt: 1,
  seq: 1,
  meta: null,
});

const A = "resolve the bug with the widgets not resizing correctly";
const B = "plan the sourdough starter feeding schedule for the whole week";

test("nextTitle is threads + 1 over three digits, and skips a number a delete left taken", () => {
  expect(nextTitle([])).toBe("Thread: 001");
  expect(nextTitle(["a", "b", "c"])).toBe("Thread: 004");
  expect(nextTitle(["Thread: 001", "Thread: 003"])).toBe("Thread: 004"); // 2 + 1 = 003, already there
  expect(nextTitle(Array.from({ length: 999 }, (_, i) => `t${i}`))).toBe("Thread: 1000");
});

test("noteText is your own words with the photos taken out", () => {
  const notes = [note("hello ![](img:abc#10x10) world"), note("Claude says", "assistant"), note("![](img:def#1x1)")];
  expect(noteText(notes)).toBe("hello  world");
});

test("a placeholder thread is named from its first note", async () => {
  const title = await titleFrom(A);
  expect(title).not.toBe("");
  expect(await autoTitle(thread("Thread: 004"), A)).toBe(title);
});

test("a title you chose is left alone, and so is a note too thin to name anything", async () => {
  expect(await autoTitle(thread("Groceries"), A)).toBeNull();
  expect(await autoTitle(thread("Thread: 004"), "hi")).toBeNull();
});

test("editing the first note renames a title we derived, not one you changed since", async () => {
  expect(await autoTitle(thread(await titleFrom(A)), B, A)).toBe(await titleFrom(B));
  expect(await autoTitle(thread("Groceries"), B, A)).toBeNull();
  expect(await autoTitle(thread(await titleFrom(A)), A, A)).toBeNull(); // same text, same title: nothing to write
});

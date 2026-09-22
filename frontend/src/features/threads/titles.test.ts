import { expect, test } from "bun:test";
import type { Message, Thread } from "@/lib/types";
import { autoTitle, isPlaceholderTitle, nextTitle, noteText, titleFrom } from "./titles";

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

test("isPlaceholderTitle only matches the auto-generated Thread: NNN shape", () => {
  expect(isPlaceholderTitle("Thread: 004")).toBe(true);
  expect(isPlaceholderTitle("Thread: 1000")).toBe(true);
  expect(isPlaceholderTitle("Groceries")).toBe(false);
  expect(isPlaceholderTitle("Thread: 4")).toBe(false);
});

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

test("a still-placeholder title gets another shot once a later note gives it more to name", async () => {
  // "hi" alone names nothing; concatenated with a real note, it does.
  expect(await autoTitle(thread("Thread: 004"), "hi")).toBeNull();
  const combined = `hi\n\n${A}`;
  expect(await autoTitle(thread("Thread: 004"), combined)).toBe(await titleFrom(combined));
});

test("once a title is real (yours or already auto-picked), a later note never overwrites it", async () => {
  const picked = await titleFrom(A);
  // No `previous` is passed for a later note's retry, so a title that is no longer the placeholder is left alone.
  expect(await autoTitle(thread(picked), `${A}\n\n${B}`)).toBeNull();
  expect(await autoTitle(thread("Groceries"), `${A}\n\n${B}`)).toBeNull();
});

test("editing the first note renames a title we derived, not one you changed since", async () => {
  expect(await autoTitle(thread(await titleFrom(A)), B, A)).toBe(await titleFrom(B));
  expect(await autoTitle(thread("Groceries"), B, A)).toBeNull();
  expect(await autoTitle(thread(await titleFrom(A)), A, A)).toBeNull(); // same text, same title: nothing to write
});

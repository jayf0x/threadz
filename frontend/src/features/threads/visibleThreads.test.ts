import { expect, test } from "bun:test";
import type { Thread } from "@/lib/types";
import { isSort, visibleThreads } from "./visibleThreads";

const t = (id: string, o: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  renamedAt: null,
  description: null,
  tags: [],
  hasEmbedding: false,
  ...o,
});

const ids = (rows: Thread[]) => rows.map((r) => r.id);

test("orders by updated (default), created, or title when there's no query", () => {
  const rows = [
    t("b", { updatedAt: 1, createdAt: 3 }),
    t("a", { updatedAt: 3, createdAt: 1 }),
    t("c", { updatedAt: 2, createdAt: 2 }),
  ];
  expect(ids(visibleThreads(rows, "", "updated"))).toEqual(["a", "c", "b"]);
  expect(ids(visibleThreads(rows, "", "created"))).toEqual(["b", "c", "a"]);
  expect(ids(visibleThreads(rows, "", "title"))).toEqual(["a", "b", "c"]);
});

test("search matches the title, case-insensitively, and never mutates the input", () => {
  const rows = [t("Sourdough Bread"), t("x", { description: "About BREAD" }), t("y", { tags: ["bread"] }), t("z")];
  expect(ids(visibleThreads(rows, "  bread ", "title"))).toEqual(["Sourdough Bread"]);
  expect(ids(rows)).toEqual(["Sourdough Bread", "x", "y", "z"]);
});

test("isSort accepts only known sorts", () => {
  expect(isSort("title")).toBe(true);
  expect(isSort("nope")).toBe(false);
});

test("a thread found only by the text of a note (content hit from the API) is shown", () => {
  const rows = [t("a"), t("b")];
  const hits = new Map([["b", 0]]);
  expect(ids(visibleThreads(rows, "needle", "updated", hits))).toEqual(["b"]);
});

test("while searching, a title match always outranks a content-only hit, regardless of `sort`", () => {
  const rows = [t("b", { updatedAt: 5 }), t("needle-title", { updatedAt: 0 })];
  const hits = new Map([["b", 0]]); // b matched only via a note, and ranked first by the API
  expect(ids(visibleThreads(rows, "needle", "updated", hits))).toEqual(["needle-title", "b"]);
});

test("among content-only hits, the API's own rank order (lower = better) decides the order", () => {
  const rows = [t("a"), t("b"), t("c")];
  const hits = new Map([
    ["c", 0],
    ["a", 1],
    ["b", 2],
  ]);
  expect(ids(visibleThreads(rows, "needle", "created", hits))).toEqual(["c", "a", "b"]);
});

test("pinned threads float to the top regardless of sort, keeping relative order within each group", () => {
  const rows = [t("a", { updatedAt: 1 }), t("b", { updatedAt: 2 }), t("c", { updatedAt: 3 }), t("d", { updatedAt: 4 })];
  const pinned = new Set(["a", "c"]);
  expect(ids(visibleThreads(rows, "", "updated", new Map(), pinned))).toEqual(["c", "a", "d", "b"]);
});

test("pinning also floats a match to the top while searching", () => {
  const rows = [t("apple"), t("apricot")];
  const pinned = new Set(["apricot"]);
  expect(ids(visibleThreads(rows, "ap", "updated", new Map(), pinned))).toEqual(["apricot", "apple"]);
});

test("hidden ids are dropped entirely, from both the no-query and search paths", () => {
  const rows = [t("a"), t("b"), t("c")];
  const hidden = new Set(["b"]);
  expect(ids(visibleThreads(rows, "", "updated", new Map(), new Set(), hidden))).toEqual(["a", "c"]);
  expect(ids(visibleThreads(rows, "a", "updated", new Map(), new Set(), hidden))).toEqual(["a"]);
});

import { expect, test } from "bun:test";
import type { Thread } from "@/lib/types";
import { isSort, visibleThreads } from "./visibleThreads";

const t = (id: string, o: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  renamedAt: null,
  source: "pwa",
  description: null,
  tags: [],
  hasEmbedding: false,
  ...o,
});

const ids = (rows: Thread[]) => rows.map((r) => r.id);

test("orders by updated (default), created, or title", () => {
  const rows = [
    t("b", { updatedAt: 1, createdAt: 3 }),
    t("a", { updatedAt: 3, createdAt: 1 }),
    t("c", { updatedAt: 2, createdAt: 2 }),
  ];
  expect(ids(visibleThreads(rows, "", "updated"))).toEqual(["a", "c", "b"]);
  expect(ids(visibleThreads(rows, "", "created"))).toEqual(["b", "c", "a"]);
  expect(ids(visibleThreads(rows, "", "title"))).toEqual(["a", "b", "c"]);
});

test("search matches title, description or tag, case-insensitively, and never mutates the input", () => {
  const rows = [t("Sourdough"), t("x", { description: "About BREAD" }), t("y", { tags: ["bread"] }), t("z")];
  expect(ids(visibleThreads(rows, "  bread ", "title"))).toEqual(["x", "y"]);
  expect(ids(rows)).toEqual(["Sourdough", "x", "y", "z"]);
});

test("isSort accepts only known sorts", () => {
  expect(isSort("title")).toBe(true);
  expect(isSort("nope")).toBe(false);
});

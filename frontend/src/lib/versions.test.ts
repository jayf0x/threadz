import { expect, test } from "bun:test";
import { mergeVersions } from "./versions";

const v = (content: string, at: number) => ({ content, at });

test("mergeVersions: newest wins, the rest become history oldest-first", () => {
  const { current, edits } = mergeVersions([v("a", 1), v("c", 3)], [v("b", 2)]);
  expect(current).toEqual(v("c", 3));
  expect(edits).toEqual([v("a", 1), v("b", 2)]);
});

test("mergeVersions: symmetric, and a version seen on both sides (same `at`) is kept once", () => {
  const a = [v("a", 1), v("b", 2)];
  const b = [v("b", 2), v("c", 3)];
  expect(mergeVersions(a, b)).toEqual(mergeVersions(b, a));
  expect(mergeVersions(a, b).edits).toHaveLength(2);
});

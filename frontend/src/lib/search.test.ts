import { expect, test } from "bun:test";
import { combineScore, matchScore } from "./search";

test("exact substring still matches, earlier position scores higher", () => {
  const early = matchScore("research notes", "research");
  const late = matchScore("my research notes", "research");
  expect(early).not.toBeNull();
  expect(late).not.toBeNull();
  expect(early as number).toBeGreaterThan(late as number);
});

test("no match at all returns null", () => {
  expect(matchScore("research notes", "xyzzy")).toBeNull();
});

test("a one-letter substitution typo still matches", () => {
  // "reserch" is "research" missing an 'a'.
  expect(matchScore("weekly research notes", "reserch")).toBeGreaterThan(0);
});

test("an adjacent-letter transposition typo still matches", () => {
  // "reserach" swaps the 'a' and 'r' in "research".
  expect(matchScore("weekly research notes", "reserach")).toBeGreaterThan(0);
});

test("reordered words still match, regardless of order in the haystack", () => {
  expect(matchScore("weekly research notes", "notes research")).toBeGreaterThan(0);
  expect(matchScore("weekly research notes", "research notes")).toBeGreaterThan(0);
});

test("a partial word still matches as a prefix", () => {
  expect(matchScore("weekly research notes", "rese")).toBeGreaterThan(0);
});

test("an exact match still outranks a fuzzy match for the same needle", () => {
  const exact = matchScore("research notes", "research");
  const fuzzy = matchScore("reserach notes", "research");
  expect(exact).not.toBeNull();
  expect(fuzzy).not.toBeNull();
  expect(exact as number).toBeGreaterThan(fuzzy as number);
});

test("an unrelated word blocks the match even if other words fuzzy-match", () => {
  expect(matchScore("weekly research notes", "research unrelatedword")).toBeNull();
});

test("very short needle words require containment, not fuzzy tolerance", () => {
  // "of" only matches a haystack word that contains it as-is.
  expect(matchScore("weekly research notes", "of")).toBeNull();
  expect(matchScore("office research notes", "of")).toBeGreaterThan(0);
});

test("combineScore still prefers a title match over a content-only match", () => {
  const titleOnly = combineScore(matchScore("research plan", "reserach"), null);
  const contentOnly = combineScore(null, -0);
  expect(titleOnly).not.toBeNull();
  expect(contentOnly).not.toBeNull();
  expect(titleOnly as number).toBeGreaterThan(contentOnly as number);
});

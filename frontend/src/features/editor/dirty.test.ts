import { expect, test } from "bun:test";
import { isDirty } from "./dirty";

test("identical text is clean, any real change is dirty", () => {
  expect(isDirty("a\n\nb", "a\n\nb")).toBe(false);
  expect(isDirty("a\n\nb", "a\n\nbc")).toBe(true);
  expect(isDirty("a", "")).toBe(true);
});

test("whitespace at the ends of the document is not an edit", () => {
  expect(isDirty("hello\n", "hello")).toBe(false);
  expect(isDirty("  hello", "hello\n\n")).toBe(false);
  expect(isDirty("a\r\nb", "a\nb")).toBe(false);
});

test("whitespace inside the document is an edit", () => {
  expect(isDirty("a b", "a  b")).toBe(true);
  expect(isDirty("a\n\nb", "a\nb")).toBe(true);
});

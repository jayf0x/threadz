import { expect, test } from "bun:test";
import { cleanTranscript, spliceAtCaret } from "./text";

// "Type hello, speak world (or the reverse) without either eating the other."

test("speak after typing: one space, caret after the dictated text", () => {
  expect(spliceAtCaret("hello", 5, "world")).toEqual({ value: "hello world", caret: 11 });
});

test("type after speaking: dictation left no trailing space to fight punctuation", () => {
  const r = spliceAtCaret("hello", 5, "world");
  expect(r.value.slice(r.caret)).toBe("");
});

test("speak into an empty box or after a newline: no leading space", () => {
  expect(spliceAtCaret("", 0, "hi")).toEqual({ value: "hi", caret: 2 });
  expect(spliceAtCaret("a\n", 2, "b").value).toBe("a\nb");
});

test("speak mid-text: the word on the right is not glued on, punctuation is not spaced off", () => {
  expect(spliceAtCaret("hello world", 6, "big").value).toBe("hello big world");
  expect(spliceAtCaret("hello.", 5, "world").value).toBe("hello world.");
});

test("out-of-range caret is clamped", () => {
  expect(spliceAtCaret("ab", 99, "c").value).toBe("ab c");
});

test("non-speech annotations are dropped, real speech survives", () => {
  expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
  expect(cleanTranscript("♪ la la ♪")).toBe("");
  expect(cleanTranscript("(music) hello")).toBe("hello");
  expect(cleanTranscript("*sigh* Hello there.")).toBe("Hello there.");
  expect(cleanTranscript("...")).toBe("");
});

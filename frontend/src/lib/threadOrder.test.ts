import { expect, test } from "bun:test";
import { isThreadReversed, orderMessages, setThreadReversed } from "./threadOrder";

test("orderMessages leaves the array as-is when not reversed", () => {
  const messages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(orderMessages(messages, false)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
});

test("orderMessages reverses (oldest-last becomes newest-first) without mutating the input", () => {
  const messages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(orderMessages(messages, true)).toEqual([{ id: "c" }, { id: "b" }, { id: "a" }]);
  expect(messages).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]); // original untouched
});

test("a thread that's never been flipped defaults to not reversed", () => {
  expect(isThreadReversed("thread-never-touched")).toBe(false);
});

test("flipping a thread persists it, flipping back returns it to the default", () => {
  setThreadReversed("thread-flip", true);
  expect(isThreadReversed("thread-flip")).toBe(true);

  setThreadReversed("thread-flip", false);
  expect(isThreadReversed("thread-flip")).toBe(false);
});

test("threads are independent", () => {
  setThreadReversed("thread-a", true);
  expect(isThreadReversed("thread-b")).toBe(false);
});

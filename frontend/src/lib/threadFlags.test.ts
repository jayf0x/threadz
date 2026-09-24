import { expect, test } from "bun:test";
import { isThreadFlagSet, setThreadFlag } from "./threadFlags";

test("a thread that's never had a flag set defaults to false", () => {
  expect(isThreadFlagSet("pinned", "thread-never-touched")).toBe(false);
});

test("setting a flag persists it, unsetting returns it to the default", () => {
  setThreadFlag("pinned", "thread-flag", true);
  expect(isThreadFlagSet("pinned", "thread-flag")).toBe(true);

  setThreadFlag("pinned", "thread-flag", false);
  expect(isThreadFlagSet("pinned", "thread-flag")).toBe(false);
});

test("threads are independent", () => {
  setThreadFlag("pinned", "thread-a", true);
  expect(isThreadFlagSet("pinned", "thread-b")).toBe(false);
});

test("flags are independent per thread", () => {
  setThreadFlag("pinned", "thread-multi", true);
  expect(isThreadFlagSet("resolved", "thread-multi")).toBe(false);

  setThreadFlag("resolved", "thread-multi", true);
  expect(isThreadFlagSet("pinned", "thread-multi")).toBe(true);
  expect(isThreadFlagSet("resolved", "thread-multi")).toBe(true);
});

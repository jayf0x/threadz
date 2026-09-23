import { expect, test } from "bun:test";
import { deepLinkSearch, deepLinkUrl, parseDeepLink } from "./deepLink";

test("parseDeepLink reads thread and msg, either or both absent", () => {
  expect(parseDeepLink("")).toEqual({ threadId: null, messageId: null });
  expect(parseDeepLink("?thread=t1")).toEqual({ threadId: "t1", messageId: null });
  expect(parseDeepLink("?thread=t1&msg=m1")).toEqual({ threadId: "t1", messageId: "m1" });
  expect(parseDeepLink("?msg=m1")).toEqual({ threadId: null, messageId: "m1" }); // msg alone is meaningless but still parses
  expect(parseDeepLink("?other=1")).toEqual({ threadId: null, messageId: null });
});

test("deepLinkSearch is empty with nothing selected", () => {
  expect(deepLinkSearch(null, null)).toBe("");
  expect(deepLinkSearch(null, "m1")).toBe(""); // a message id means nothing without its thread
});

test("deepLinkSearch carries the thread alone, or with its message", () => {
  expect(deepLinkSearch("t1", null)).toBe("thread=t1");
  expect(deepLinkSearch("t1", "m1")).toBe("thread=t1&msg=m1");
});

test("deepLinkSearch round-trips through parseDeepLink", () => {
  for (const [threadId, messageId] of [
    ["t1", "m1"],
    ["t1", null],
    [null, null],
  ] as const) {
    expect(parseDeepLink(`?${deepLinkSearch(threadId, messageId)}`)).toEqual({
      threadId,
      messageId: threadId ? messageId : null,
    });
  }
});

test("deepLinkUrl keeps the page's own pathname and hash, only ever touching the query", () => {
  expect(deepLinkUrl("/threadz/", "#top", null, null)).toBe("/threadz/#top");
  expect(deepLinkUrl("/threadz/", "", "t1", null)).toBe("/threadz/?thread=t1");
  expect(deepLinkUrl("/", "", "t1", "m1")).toBe("/?thread=t1&msg=m1");
});

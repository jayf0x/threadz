import { expect, test } from "bun:test";
import { draftStorageKey } from "./useDraft";

test("draftStorageKey namespaces any target string the same way", () => {
  expect(draftStorageKey("t1")).toBe("threadz.draft.t1");
  expect(draftStorageKey("annotation:m1")).toBe("threadz.draft.annotation:m1");
});

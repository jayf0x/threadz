import { expect, test } from "bun:test";
import { isBusy } from "./idle";

// Stub root: `querySelectorAll` returns only the writable editors, as the real selector would.
const root = (...texts: string[]) =>
  ({ querySelectorAll: () => texts.map((textContent) => ({ textContent })) }) as never;

test("busy only when a writable editor holds text", () => {
  expect(isBusy(root("hi"))).toBe(true);
  expect(isBusy(root(" ", ""))).toBe(false);
  expect(isBusy(root())).toBe(false);
});

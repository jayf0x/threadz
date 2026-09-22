import { expect, test } from "bun:test";
import { computePopoverPosition } from "./popover";

const viewport = { width: 1024, height: 768 };

test("trigger near the top opens below (unchanged behaviour)", () => {
  const rect = { top: 40, bottom: 68, left: 20, right: 60 };
  expect(computePopoverPosition("start", rect, 200, viewport)).toEqual({
    top: 74,
    left: 20,
  });
});

test("trigger near the bottom flips to open above instead of overflowing", () => {
  const rect = { top: 720, bottom: 748, left: 20, right: 60 };
  expect(computePopoverPosition("start", rect, 200, viewport)).toEqual({
    bottom: 54,
    left: 20,
  });
});

test("align=end flips too, and keeps clamping from the right edge", () => {
  const rect = { top: 720, bottom: 748, left: 980, right: 1010 };
  expect(computePopoverPosition("end", rect, 200, viewport)).toEqual({
    bottom: 54,
    right: 14,
  });
});

test("horizontal clamping still applies at 8px minimum near the left edge", () => {
  const rect = { top: 40, bottom: 68, left: -10, right: 30 };
  expect(computePopoverPosition("start", rect, 200, viewport)).toEqual({
    top: 74,
    left: 8,
  });
});

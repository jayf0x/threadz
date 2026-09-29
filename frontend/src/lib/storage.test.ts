import { expect, test } from "bun:test";
import { formatBytes } from "./storage";

test("formatBytes picks the unit and precision", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
  expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
});

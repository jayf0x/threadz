import { expect, test } from "bun:test";
import { prepareImportBytes } from "./importHeader";

const file = (mode: number) => {
  const b = new Uint8Array(4096);
  b.set(new TextEncoder().encode("SQLite format 3\0"));
  b[18] = mode;
  b[19] = mode;
  return b;
};

test("a WAL-mode header is rewritten to rollback-journal on a copy", () => {
  const wal = file(2);
  const out = prepareImportBytes(wal);
  expect([out[18], out[19]]).toEqual([1, 1]);
  expect(wal[18]).toBe(2);
});

test("a rollback-journal file passes through untouched", () => {
  const plain = file(1);
  expect(prepareImportBytes(plain)).toBe(plain);
});

test("a non-SQLite file is rejected with a clear message", () => {
  expect(() => prepareImportBytes(new Uint8Array(200))).toThrow("Not a SQLite database file.");
});

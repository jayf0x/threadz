import { expect, test } from "bun:test";
import { countChanges } from "./merge";
import { generateSeed, SCALES } from "./seed";

const ids = (c: ReturnType<typeof generateSeed>) => new Set(c.entities.map((e) => e.id));

test("seed: batches with different salts never share an id; the same params repeat exactly", () => {
  const params = { counts: SCALES.small, now: Date.UTC(2026, 0, 1) };
  const a = generateSeed({ ...params, seed: 1, salt: 0xa1 });
  const b = generateSeed({ ...params, seed: 1, salt: 0xb2 });
  expect(countChanges(a)).toBe(countChanges(b));
  expect([...ids(a)].filter((id) => ids(b).has(id))).toEqual([]);
  expect(JSON.stringify(generateSeed({ ...params, seed: 1, salt: 0xa1 }))).toBe(JSON.stringify(a));
});

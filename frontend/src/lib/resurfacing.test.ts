import { expect, test } from "bun:test";
import { pickResurfacingThread } from "./resurfacing";
import type { Thread } from "./types";

const thread = (id: string, updatedAt: number): Thread => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  description: null,
  tags: [],
  hasEmbedding: false,
});

// Deterministic PRNG (mulberry32) so the statistical trials below are reproducible, not flaky.
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("pickResurfacingThread: empty list returns undefined", () => {
  expect(pickResurfacingThread([])).toBeUndefined();
});

test("pickResurfacingThread: single thread is always picked", () => {
  const t = thread("a", 1000);
  expect(pickResurfacingThread([t], () => 0.5, 2000)).toBe(t);
});

test("pickResurfacingThread: weighted selection picks by cumulative staleness", () => {
  const now = 10_000;
  const old = thread("old", 0); // staleness 10000
  const recent = thread("recent", 9000); // staleness 1000
  const threads = [old, recent];
  // total weight = 11000; rand() * total landing in [0, 10000) selects `old`, the remainder `recent`.
  expect(pickResurfacingThread(threads, () => 0, now)).toBe(old);
  expect(pickResurfacingThread(threads, () => 10_000 / 11_000 + 0.001, now)).toBe(recent);
  expect(pickResurfacingThread(threads, () => 0.999999, now)).toBe(recent);
});

test("pickResurfacingThread: over many trials, an old thread resurfaces far more than a flat 50/50 pick would", () => {
  const now = 100_000;
  const old = thread("old", 0); // staleness 100000
  const recent = thread("recent", 90_000); // staleness 10000
  const threads = [old, recent];
  const rand = mulberry32(42);

  const trials = 5000;
  let oldCount = 0;
  for (let i = 0; i < trials; i++) {
    if (pickResurfacingThread(threads, rand, now) === old) oldCount++;
  }

  // Expected ratio ~= 100000 / 110000 ~= 0.909; assert it clearly clears flat-random (0.5).
  expect(oldCount / trials).toBeGreaterThan(0.8);
});

test("pickResurfacingThread: oldest resurfaces most often but not exclusively (skewed, not sorted)", () => {
  const now = 30_000;
  const oldest = thread("oldest", 0); // staleness 30000
  const middle = thread("middle", 20_000); // staleness 10000
  const newest = thread("newest", 29_000); // staleness 1000
  const threads = [oldest, middle, newest];
  const rand = mulberry32(7);

  const counts: Record<string, number> = { oldest: 0, middle: 0, newest: 0 };
  const trials = 6000;
  for (let i = 0; i < trials; i++) {
    const picked = pickResurfacingThread(threads, rand, now);
    if (picked) counts[picked.id] = (counts[picked.id] ?? 0) + 1;
  }

  expect(counts.oldest ?? 0).toBeGreaterThan(counts.middle ?? 0);
  expect(counts.middle ?? 0).toBeGreaterThan(counts.newest ?? 0);
  expect(counts.newest ?? 0).toBeGreaterThan(0); // not strictly oldest-first — newest still shows up sometimes
});

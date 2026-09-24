import type { Thread } from "./types";

// Resurfacing: pick one thread to show back to the user, weighted so older / less-recently-updated
// threads come up more often — but not strictly oldest-first, so it still feels like "oh, I forgot
// about this" rather than a predictable queue. Weight is staleness since `updatedAt` (ms), floored at
// 1 so nothing is ever fully excluded; selection is weighted-random over that, not a sort. `rand` is
// injectable (defaults to Math.random) so tests can drive it deterministically.
export const pickResurfacingThread = (
  threads: Thread[],
  rand: () => number = Math.random,
  now: number = Date.now(),
): Thread | undefined => {
  if (threads.length === 0) return undefined;

  const weights = threads.map((t) => Math.max(1, now - t.updatedAt));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let target = rand() * total;
  for (let i = 0; i < threads.length; i++) {
    target -= weights[i] ?? 0;
    if (target <= 0) return threads[i];
  }

  // Floating-point fallback: rand() returning exactly 1 (or rounding) can leave target > 0 after the
  // loop. The last thread is as good a fallback as any — it was already in the weighted pool.
  return threads.at(-1);
};

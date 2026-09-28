import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

// Isolated DB path before importing db.ts, same pattern as tests/backend.test.ts -- this suite only
// exercises the pure `selectBackupsToKeep`, but importing the module still opens a bun:sqlite file.
process.env.THREADZ_DB = `${tmpdir()}/threadz-db-test-${crypto.randomUUID()}.sqlite`;

const { selectBackupsToKeep } = await import("./db.ts");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

describe("selectBackupsToKeep", () => {
  test("within the last day: keeps roughly one per hour, not every 15s backup", () => {
    const now = Date.now();
    const backups: { path: string; timestamp: number }[] = [];
    for (let t = now - 2 * HOUR; t <= now; t += 15_000) {
      backups.push({ path: `b${t}`, timestamp: t });
    }
    const keep = selectBackupsToKeep(backups, now);
    // ~2 hours of 15s backups spans at most 3 hour-buckets, never anywhere near the ~480 inputs.
    expect(keep.size).toBeGreaterThan(0);
    expect(keep.size).toBeLessThanOrEqual(3);
  });

  test("2-20 days old: keeps roughly one per day", () => {
    const now = Date.now();
    const backups: { path: string; timestamp: number }[] = [];
    for (let d = 2; d <= 20; d++) {
      for (let h = 0; h < 24; h += 4) {
        backups.push({ path: `d${d}h${h}`, timestamp: now - d * DAY - h * HOUR });
      }
    }
    const keep = selectBackupsToKeep(backups, now);
    // 19 distinct day-offsets (2..20), each spanning up to 20 hours -- one survivor per day, plus at
    // most one extra bucket where a span straddles a day boundary (not one-per-backup: 19*6 inputs).
    expect(keep.size).toBeGreaterThanOrEqual(19);
    expect(keep.size).toBeLessThanOrEqual(20);
  });

  test("older than a month: keeps roughly one per week", () => {
    const now = Date.now();
    const backups: { path: string; timestamp: number }[] = [];
    for (let w = 5; w <= 20; w++) {
      backups.push({ path: `w${w}a`, timestamp: now - w * WEEK });
      backups.push({ path: `w${w}b`, timestamp: now - w * WEEK - DAY });
    }
    const keep = selectBackupsToKeep(backups, now);
    // Each pair straddles a week boundary at most, so at most 2 buckets per w, but always <= inputs
    // and clearly bucketed (not one-per-backup).
    expect(keep.size).toBeLessThan(backups.length);
    expect(keep.size).toBeGreaterThanOrEqual(16);
  });

  test("keeps the newest survivor within a bucket, so a fresh backup is never pruned by an older one in the same hour", () => {
    const now = Math.floor(Date.now() / HOUR) * HOUR + 45 * 60_000; // mid-hour so the three never straddle a bucket edge
    const backups = [
      { path: "oldest", timestamp: now - 30 * 60_000 },
      { path: "middle", timestamp: now - 20 * 60_000 },
      { path: "newest", timestamp: now - 10 * 60_000 },
    ];
    const keep = selectBackupsToKeep(backups, now);
    expect(keep.size).toBe(1);
    expect(keep.has("newest")).toBe(true);
  });

  test("boundary: just under a day old still buckets hourly, just over buckets daily", () => {
    const now = Date.now();
    const backups = [
      { path: "justUnderDay", timestamp: now - (DAY - HOUR) },
      { path: "justOverDay", timestamp: now - (DAY + HOUR) },
    ];
    const keep = selectBackupsToKeep(backups, now);
    // Different bucket kinds (hour vs day) at nearly the same age -- both survive independently.
    expect(keep.size).toBe(2);
  });

  test("boundary: just under a month old buckets daily, just over buckets weekly", () => {
    const now = Date.now();
    const backups = [
      { path: "justUnderMonth", timestamp: now - (MONTH - HOUR) },
      { path: "justOverMonth", timestamp: now - (MONTH + HOUR) },
    ];
    const keep = selectBackupsToKeep(backups, now);
    expect(keep.size).toBe(2);
  });

  test("empty input keeps nothing", () => {
    expect(selectBackupsToKeep([], Date.now()).size).toBe(0);
  });
});

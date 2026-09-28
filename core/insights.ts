import { isPinStale, latestContentSql } from "./queries";
import type { Driver } from "./schema";

// Insight v1 (docs/direction.md "Round 7"): deterministic, templated sentences over counts and co-occurrences.
// Every insight carries the lens and filter that produced it; a query with no source or a zero count yields
// nothing. `now` is an argument, never read from the clock. Weekday/hour buckets use UTC so results don't
// depend on the machine's timezone. Age thresholds are inclusive (`>=`).

export const DAY_MS = 86_400_000;
export const RHYTHM_WINDOW_DAYS = 30;
export const RHYTHM_MIN_NOTES = 5;
export const STALE_THREAD_DAYS = 30;
export const POOL_OLD_DAYS = 7;
export const TODO_OLD_DAYS = 7;
export const MOST_LINKED_TOP = 3;
export const COOCCUR_MIN = 3;
export const COOCCUR_TOP = 3;

export type InsightLens = "thread" | "todos" | "pool" | "bin" | "search" | "map";
export type InsightKind =
  | "writing-rhythm"
  | "stale-threads"
  | "pool-old"
  | "todos-old"
  | "most-linked"
  | "co-occurrence"
  | "stale-pins";
export type InsightSource = { lens: InsightLens; filter: Record<string, string | number> };
export type Insight = { id: string; kind: InsightKind; text: string; source: InsightSource; n: number };

export type InsightQuery = (d: Driver, now: number) => Promise<Insight[]>;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (ms: number) => Math.floor(ms / DAY_MS);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

// Index of the largest count; ties go to the lowest index so the result is stable.
const argmax = (counts: number[]): number => counts.reduce((best, c, i) => (c > (counts[best] ?? 0) ? i : best), 0);

// 1. Busiest weekday and hour of day over the last 30 days, from live notes' `created_at`.
export const writingRhythm: InsightQuery = async (d, now) => {
  const from = now - RHYTHM_WINDOW_DAYS * DAY_MS;
  const rows = await d.all<{ created_at: number }>(
    "SELECT created_at FROM entities WHERE kind = 'note' AND deleted_at IS NULL AND created_at >= ? AND created_at <= ?",
    [from, now],
  );
  if (rows.length < RHYTHM_MIN_NOTES) return [];
  const byDay = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  for (const r of rows) {
    const date = new Date(r.created_at);
    byDay[date.getUTCDay()] = (byDay[date.getUTCDay()] ?? 0) + 1;
    byHour[date.getUTCHours()] = (byHour[date.getUTCHours()] ?? 0) + 1;
  }
  const day = argmax(byDay);
  const hour = argmax(byHour);
  const range = { from, to: now };
  return [
    {
      id: "writing-rhythm:weekday",
      kind: "writing-rhythm",
      text: `You write most on ${WEEKDAYS[day]}s: ${plural(byDay[day] ?? 0, "note")} in the last ${RHYTHM_WINDOW_DAYS} days.`,
      source: { lens: "map", filter: { ...range, weekday: day } },
      n: byDay[day] ?? 0,
    },
    {
      id: "writing-rhythm:hour",
      kind: "writing-rhythm",
      text: `Your busiest hour is ${hourLabel(hour)} (UTC): ${plural(byHour[hour] ?? 0, "note")} in the last ${RHYTHM_WINDOW_DAYS} days.`,
      source: { lens: "map", filter: { ...range, hour } },
      n: byHour[hour] ?? 0,
    },
  ];
};

// 2. Live threads not updated for 30+ days.
export const staleThreads: InsightQuery = async (d, now) => {
  const cutoff = now - STALE_THREAD_DAYS * DAY_MS;
  const rows = await d.all<{ updated_at: number }>(
    `SELECT t.updated_at FROM threads t JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL AND t.updated_at <= ? ORDER BY t.updated_at`,
    [cutoff],
  );
  const oldest = rows[0];
  if (!oldest) return [];
  return [
    {
      id: "stale-threads",
      kind: "stale-threads",
      text: `${plural(rows.length, "thread")} untouched for ${STALE_THREAD_DAYS}+ days, the oldest for ${plural(days(now - oldest.updated_at), "day")}.`,
      source: { lens: "thread", filter: { updatedBefore: cutoff } },
      n: rows.length,
    },
  ];
};

// 3. Pool notes (no live message) created 7+ days ago.
export const poolOld: InsightQuery = async (d, now) => {
  const cutoff = now - POOL_OLD_DAYS * DAY_MS;
  const [row] = await d.all<{ n: number; oldest: number | null }>(
    `SELECT COUNT(*) AS n, MIN(e.created_at) AS oldest FROM entities e
     WHERE e.kind = 'note' AND e.deleted_at IS NULL AND e.created_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM messages m JOIN entities me ON me.id = m.id
         WHERE m.note_id = e.id AND m.removed_at IS NULL AND me.deleted_at IS NULL
       )`,
    [cutoff],
  );
  if (!row || row.n === 0 || row.oldest === null) return [];
  return [
    {
      id: "pool-old",
      kind: "pool-old",
      text: `${plural(row.n, "note")} in the Pool for ${POOL_OLD_DAYS}+ days, the oldest for ${plural(days(now - row.oldest), "day")}.`,
      source: { lens: "pool", filter: { createdBefore: cutoff } },
      n: row.n,
    },
  ];
};

// 4. Open todos whose target was created 7+ days ago.
export const todosOld: InsightQuery = async (d, now) => {
  const cutoff = now - TODO_OLD_DAYS * DAY_MS;
  const [row] = await d.all<{ n: number; oldest: number | null }>(
    `SELECT COUNT(*) AS n, MIN(e.created_at) AS oldest FROM todos t
     JOIN entities e ON e.id = t.target_id
     WHERE t.done = 0 AND e.deleted_at IS NULL AND e.created_at <= ?`,
    [cutoff],
  );
  if (!row || row.n === 0 || row.oldest === null) return [];
  return [
    {
      id: "todos-old",
      kind: "todos-old",
      text: `${plural(row.n, "open todo")} older than ${TODO_OLD_DAYS} days, the oldest ${plural(days(now - row.oldest), "day")} old.`,
      source: { lens: "todos", filter: { createdBefore: cutoff } },
      n: row.n,
    },
  ];
};

const firstLine = (content: string): string => {
  const line = content.split("\n").find((l) => l.trim()) ?? "";
  const t = line.replace(/^#+\s*/, "").trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
};

// 5. Top notes by live links in + out.
export const mostLinked: InsightQuery = async (d) => {
  const rows = await d.all<{ id: string; n: number; content: string | null }>(
    `SELECT e.id, COUNT(*) AS n,
       ${latestContentSql("e.id")} AS content
     FROM (SELECT from_id AS eid, id AS lid FROM links UNION ALL SELECT to_id, id FROM links) x
     JOIN entities le ON le.id = x.lid AND le.deleted_at IS NULL
     JOIN entities e ON e.id = x.eid AND e.kind = 'note' AND e.deleted_at IS NULL
     GROUP BY e.id ORDER BY n DESC, e.id LIMIT ?`,
    [MOST_LINKED_TOP],
  );
  return rows
    .filter((r) => r.n > 0)
    .map((r) => ({
      id: `most-linked:${r.id}`,
      kind: "most-linked" as const,
      text: `“${firstLine(r.content ?? "") || "Untitled note"}” has ${plural(r.n, "link")}.`,
      source: { lens: "map" as const, filter: { linkedTo: r.id } },
      n: r.n,
    }));
};

// 6. Property values (set + value) that sit on the same target 3+ times.
export const coOccurrence: InsightQuery = async (d) => {
  const rows = await d.all<{ target_id: string; set_id: string; value: string | null; name: string }>(
    `SELECT pv.target_id, pv.set_id, pv.value, ps.name FROM property_values pv
     JOIN property_sets ps ON ps.id = pv.set_id
     JOIN entities se ON se.id = ps.id AND se.deleted_at IS NULL
     JOIN entities te ON te.id = pv.target_id AND te.deleted_at IS NULL
     WHERE pv.removed_at IS NULL ORDER BY pv.target_id, pv.set_id, pv.value`,
  );
  type Item = { set: string; value: string; label: string };
  const byTarget = new Map<string, Map<string, Item>>();
  for (const r of rows) {
    const value = r.value ?? "";
    const items = byTarget.get(r.target_id) ?? new Map<string, Item>();
    items.set(`${r.set_id}\u0000${value}`, { set: r.set_id, value, label: value ? `${r.name}: ${value}` : r.name });
    byTarget.set(r.target_id, items);
  }
  const pairs = new Map<string, { a: Item; b: Item; n: number }>();
  for (const items of byTarget.values()) {
    const keys = [...items.keys()].sort();
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const ka = keys[i] as string;
        const kb = keys[j] as string;
        const key = `${ka}\u0001${kb}`;
        const hit = pairs.get(key);
        if (hit) hit.n++;
        else pairs.set(key, { a: items.get(ka) as Item, b: items.get(kb) as Item, n: 1 });
      }
  }
  return [...pairs.entries()]
    .filter(([, p]) => p.n >= COOCCUR_MIN)
    .sort(([ka, a], [kb, b]) => b.n - a.n || (ka < kb ? -1 : 1))
    .slice(0, COOCCUR_TOP)
    .map(([key, p]) => ({
      id: `co-occurrence:${key}`,
      kind: "co-occurrence" as const,
      text: `${p.a.label} and ${p.b.label} appear together ${p.n} times.`,
      source: {
        lens: "map" as const,
        filter: { setA: p.a.set, valueA: p.a.value, setB: p.b.set, valueB: p.b.value },
      },
      n: p.n,
    }));
};

// 7. Pinned links and messages whose pinned note has since gained a newer version.
export const stalePins: InsightQuery = async (d) => {
  const pins = await d.all<{ pin: string }>(
    `SELECT l.pin_version_id AS pin FROM links l JOIN entities e ON e.id = l.id
     WHERE l.pin_version_id IS NOT NULL AND e.deleted_at IS NULL
     UNION ALL
     SELECT m.pin_version_id FROM messages m JOIN entities e ON e.id = m.id
     WHERE m.pin_version_id IS NOT NULL AND m.removed_at IS NULL AND e.deleted_at IS NULL`,
  );
  let n = 0;
  for (const { pin } of pins) {
    if (await isPinStale(d, pin)) n++;
  }
  if (n === 0) return [];
  return [
    {
      id: "stale-pins",
      kind: "stale-pins",
      text: `${plural(n, "pinned reference")} point${n === 1 ? "s" : ""} at a note that has changed since.`,
      source: { lens: "map", filter: { pinned: "stale" } },
      n,
    },
  ];
};

export const allInsights: InsightQuery = async (d, now) => {
  const out: Insight[] = [];
  for (const q of [writingRhythm, staleThreads, poolOld, todosOld, mostLinked, coOccurrence, stalePins])
    out.push(...(await q(d, now)));
  return out;
};

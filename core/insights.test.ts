import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import {
  COOCCUR_MIN,
  DAY_MS,
  allInsights,
  coOccurrence,
  poolOld,
  stalePins,
  staleThreads,
  todosOld,
  writingRhythm,
} from "./insights";
import { initSchema } from "./schema";

const NOW = 100 * DAY_MS;

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};
type D = Awaited<ReturnType<typeof open>>;

const note = async (d: D, id: string, at: number, text = id) => {
  await d.run("INSERT INTO entities VALUES (?, 'note', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO note_versions VALUES (?, ?, NULL, ?, 'user', ?, NULL)", [`v-${id}`, id, text, at]);
};

test("empty database yields no insights", async () => {
  expect(await allInsights(await open(), NOW)).toEqual([]);
});

test("writing rhythm: needs enough notes inside the 30-day window", async () => {
  const d = await open();
  // 4 recent notes + 3 just outside the window: below the minimum.
  for (let i = 0; i < 4; i++) await note(d, `in${i}`, NOW - DAY_MS);
  for (let i = 0; i < 3; i++) await note(d, `out${i}`, NOW - 30 * DAY_MS - 1);
  expect(await writingRhythm(d, NOW)).toEqual([]);
  await note(d, "in4", NOW - DAY_MS);
  const [weekday, hour] = await writingRhythm(d, NOW);
  expect(weekday?.n).toBe(5);
  expect(hour?.n).toBe(5);
  expect(weekday?.source.filter.weekday).toBe(new Date(NOW - DAY_MS).getUTCDay());
});

test("stale threads: 30 days is inclusive, 29 is not", async () => {
  const d = await open();
  const thread = async (id: string, at: number) => {
    await d.run("INSERT INTO entities VALUES (?, 'thread', ?, ?, NULL, NULL)", [id, at, at]);
    await d.run("INSERT INTO threads VALUES (?, ?, ?, NULL)", [id, id, at]);
  };
  await thread("fresh", NOW - 29 * DAY_MS);
  expect(await staleThreads(d, NOW)).toEqual([]);
  await thread("old", NOW - 30 * DAY_MS);
  const [i] = await staleThreads(d, NOW);
  expect(i?.n).toBe(1);
  expect(i?.text).toContain("30 days");
});

test("pool: only unplaced notes at least 7 days old count", async () => {
  const d = await open();
  await note(d, "young", NOW - 6 * DAY_MS);
  expect(await poolOld(d, NOW)).toEqual([]);
  await note(d, "edge", NOW - 7 * DAY_MS);
  await note(d, "oldest", NOW - 20 * DAY_MS);
  const [i] = await poolOld(d, NOW);
  expect(i?.n).toBe(2);
  expect(i?.text).toContain("20 days");
});

test("open todos: done and young ones are ignored", async () => {
  const d = await open();
  await note(d, "a", NOW - 10 * DAY_MS);
  await note(d, "b", NOW - 10 * DAY_MS);
  await note(d, "c", NOW - 1 * DAY_MS);
  await d.run("INSERT INTO todos VALUES ('a', 0, 1, NULL), ('b', 1, 1, NULL), ('c', 0, 1, NULL)");
  const [i] = await todosOld(d, NOW);
  expect(i?.n).toBe(1);
  expect(i?.text).toContain("1 open todo ");
});

test("co-occurrence needs COOCCUR_MIN shared targets", async () => {
  const d = await open();
  await d.run("INSERT INTO entities VALUES ('s1', 'property_set', 0, 0, NULL, 0), ('s2', 'property_set', 0, 0, NULL, 0)");
  await d.run("INSERT INTO property_sets VALUES ('s1', 'Mood', 'text', NULL, NULL, NULL, 0, 0), ('s2', 'Topic', 'text', NULL, NULL, NULL, 0, 0)");
  for (let i = 0; i < COOCCUR_MIN; i++) {
    await note(d, `n${i}`, 1);
    await d.run("INSERT INTO property_values VALUES (?, 's1', ?, 'calm', 1, 1, NULL, NULL)", [`a${i}`, `n${i}`]);
    if (i < COOCCUR_MIN - 1)
      await d.run("INSERT INTO property_values VALUES (?, 's2', ?, 'work', 1, 1, NULL, NULL)", [`b${i}`, `n${i}`]);
  }
  expect(await coOccurrence(d, NOW)).toEqual([]);
  await d.run("INSERT INTO property_values VALUES ('bx', 's2', ?, 'work', 1, 1, NULL, NULL)", [`n${COOCCUR_MIN - 1}`]);
  const [i] = await coOccurrence(d, NOW);
  expect(i?.n).toBe(COOCCUR_MIN);
  expect(i?.text).toContain("Mood: calm");
});

test("stale pins: a pin is stale only once the note has a newer version", async () => {
  const d = await open();
  await note(d, "a", 1);
  await note(d, "b", 1);
  await d.run("INSERT INTO entities VALUES ('l1', 'link', 1, 1, NULL, NULL)");
  await d.run("INSERT INTO links VALUES ('l1', 'a', 'b', 'v-b', 1, NULL)");
  expect(await stalePins(d, NOW)).toEqual([]);
  await d.run("INSERT INTO note_versions VALUES ('v2', 'b', 'v-b', 'edited', 'user', 5, NULL)");
  expect((await stalePins(d, NOW))[0]?.n).toBe(1);
});

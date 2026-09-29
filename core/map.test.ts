import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import { isMapFilterEmpty, mapFilterToSearch, mapTracks, parseMapFilter } from "./map";
import { initSchema } from "./migrate";

const DAY = 86_400_000;
const HOUR = 3_600_000;
// 2026-01-05 is a Monday, UTC.
const MON = Date.UTC(2026, 0, 5, 9);

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};
type D = Awaited<ReturnType<typeof open>>;

const thread = async (d: D, id: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'thread', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO threads VALUES (?, ?, ?, NULL)", [id, `T ${id}`, at]);
};
const note = async (d: D, id: string, text: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'note', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO note_versions VALUES (?, ?, NULL, ?, 'user', ?, NULL)", [`v-${id}`, id, text, at]);
};
const place = async (d: D, id: string, threadId: string, noteId: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'message', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO messages VALUES (?, ?, ?, NULL, ?, NULL, NULL)", [id, threadId, noteId, at]);
};
const link = async (d: D, id: string, from: string, to: string) => {
  await d.run("INSERT INTO entities VALUES (?, 'link', 1, 1, NULL, NULL)", [id]);
  await d.run("INSERT INTO links VALUES (?, ?, ?, NULL, 1, NULL)", [id, from, to]);
};

const seed = async () => {
  const d = await open();
  await thread(d, "t1", 100);
  await thread(d, "t2", 200);
  await note(d, "n1", "shared", MON);
  await note(d, "n2", "only t1", MON + DAY);
  await note(d, "n3", "only t2", MON + 2 * DAY + 3 * HOUR);
  await place(d, "m1", "t1", "n1", MON);
  await place(d, "m2", "t1", "n2", MON + DAY);
  await place(d, "m3", "t2", "n1", MON + 1);
  await place(d, "m4", "t2", "n3", MON + 2 * DAY + 3 * HOUR);
  return d;
};

const ids = (rows: { cells: { messageId: string }[] }[]) => rows.map((r) => r.cells.map((c) => c.messageId));

test("no filter: rows newest thread first, a note in two threads is one connector", async () => {
  const d = await seed();
  const { rows, connectors } = await mapTracks(d);
  expect(rows.map((r) => r.threadId)).toEqual(["t2", "t1"]);
  expect(ids(rows)).toEqual([
    ["m3", "m4"],
    ["m1", "m2"],
  ]);
  expect(connectors).toEqual([
    {
      noteId: "n1",
      label: "shared",
      stops: [
        { row: 0, cell: 0 },
        { row: 1, cell: 0 },
      ],
    },
  ]);
});

test("a time range drops cells, empty rows, and connectors that lose a side", async () => {
  const d = await seed();
  const { rows, connectors } = await mapTracks(d, { from: MON + DAY, to: MON + 3 * DAY });
  expect(ids(rows)).toEqual([["m4"], ["m2"]]);
  expect(connectors).toEqual([]);
  expect((await mapTracks(d, { to: MON - 1 })).rows).toEqual([]);
});

test("weekday and hour buckets are UTC", async () => {
  const d = await seed();
  expect(ids((await mapTracks(d, { weekday: 1 })).rows)).toEqual([["m3"], ["m1"]]);
  expect(ids((await mapTracks(d, { hour: 12 })).rows)).toEqual([["m4"]]);
});

test("linkedTo keeps the entity itself and both directions of its links", async () => {
  const d = await seed();
  await link(d, "l1", "n2", "n3");
  expect(ids((await mapTracks(d, { linkedTo: "n3" })).rows)).toEqual([["m4"], ["m2"]]);
  expect(ids((await mapTracks(d, { linkedTo: "n2" })).rows)).toEqual([["m4"], ["m2"]]);
  await d.run("UPDATE entities SET deleted_at = 5 WHERE id = 'l1'");
  expect(ids((await mapTracks(d, { linkedTo: "n3" })).rows)).toEqual([["m4"]]);
});

test("property filter: value, any value, and a pair that must share a target", async () => {
  const d = await seed();
  for (const s of ["s1", "s2"]) {
    await d.run("INSERT INTO entities VALUES (?, 'property_set', 1, 1, NULL, NULL)", [s]);
    await d.run("INSERT INTO property_sets VALUES (?, ?, 'text', NULL, NULL, NULL, 1, NULL)", [s, s]);
  }
  const val = (id: string, set: string, target: string, v: string | null, removed: number | null = null) =>
    d.run("INSERT INTO property_values VALUES (?, ?, ?, ?, 1, 1, ?, NULL)", [id, set, target, v, removed]);
  await val("p1", "s1", "n2", "red");
  await val("p2", "s2", "n2", "big");
  await val("p3", "s1", "m4", "red");
  await val("p4", "s1", "n1", "blue");
  await val("p5", "s2", "n1", "big", 9); // removed

  expect(ids((await mapTracks(d, { setA: "s1", valueA: "red" })).rows)).toEqual([["m4"], ["m2"]]);
  expect(ids((await mapTracks(d, { setA: "s1" })).rows)).toEqual([
    ["m3", "m4"],
    ["m1", "m2"],
  ]);
  const pair = { setA: "s1", valueA: "red", setB: "s2", valueB: "big" };
  expect(ids((await mapTracks(d, pair)).rows)).toEqual([["m2"]]);
});

test("todo filter reads the message or its note; pinned:stale needs a newer version", async () => {
  const d = await seed();
  await d.run("INSERT INTO todos VALUES ('m2', 0, 1, NULL)");
  await d.run("INSERT INTO todos VALUES ('n3', 1, 1, NULL)");
  expect(ids((await mapTracks(d, { todo: "open" })).rows)).toEqual([["m2"]]);
  expect(ids((await mapTracks(d, { todo: "done" })).rows)).toEqual([["m4"]]);
  expect(ids((await mapTracks(d, { todo: "any" })).rows)).toEqual([["m4"], ["m2"]]);

  await d.run("UPDATE messages SET pin_version_id = 'v-n2' WHERE id = 'm2'");
  expect((await mapTracks(d, { pinned: "stale" })).rows).toEqual([]);
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n2', 'v-n2', 'newer', 'user', ?, NULL)", [MON + 5 * DAY]);
  expect(ids((await mapTracks(d, { pinned: "stale" })).rows)).toEqual([["m2"]]);
});

test("URL params round-trip and malformed ones are dropped", () => {
  const f = { from: 1, to: 2, weekday: 0, setA: "s", valueA: "", pinned: "stale" as const };
  expect(parseMapFilter(mapFilterToSearch(f))).toEqual(f);
  expect(parseMapFilter("from=abc&weekday=&todo=nope&pinned=fresh&junk=1&linkedTo=")).toEqual({});
  expect(isMapFilterEmpty({})).toBe(true);
  expect(isMapFilterEmpty({ hour: 0 })).toBe(false);
});

test("todo filter also matches /todo lines in the note text", async () => {
  const d = await open();
  await thread(d, "t1", 100);
  await note(d, "n1", "/todo call mom", MON);
  await note(d, "n2", "~~/todo paid~~", MON + HOUR);
  await note(d, "n3", "I said /todo nope", MON + 2 * HOUR);
  await place(d, "m1", "t1", "n1", MON);
  await place(d, "m2", "t1", "n2", MON + HOUR);
  await place(d, "m3", "t1", "n3", MON + 2 * HOUR);
  expect(ids((await mapTracks(d, { todo: "open" })).rows)).toEqual([["m1"]]);
  expect(ids((await mapTracks(d, { todo: "done" })).rows)).toEqual([["m2"]]);
  expect(ids((await mapTracks(d, { todo: "any" })).rows)).toEqual([["m1", "m2"]]);
});

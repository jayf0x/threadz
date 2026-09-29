import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import {
  applyChanges,
  changesSince,
  conflictedNotes,
  type Driver,
  initSchema,
  listVersions,
  nextParent,
  pendingChanges,
  pruneVersions,
  stampRevs,
} from "./index";

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};

const ver = (d: Driver, id: string, parent: string | null, at: number) =>
  d.run("INSERT INTO note_versions VALUES (?, 'n1', ?, ?, 'user', ?, NULL)", [id, parent, id, at]);

const note = async (d: Driver) => d.run("INSERT OR IGNORE INTO entities VALUES ('n1', 'note', 1, 1, NULL, NULL)");
const ids = async (d: Driver) =>
  (await d.all<{ id: string }>("SELECT id FROM note_versions ORDER BY created_at")).map((r) => r.id);

test("heads: a chain is one head, two children of one parent are a conflict, a merge resolves it", async () => {
  const d = await open();
  await note(d);
  await ver(d, "v1", null, 1);
  await ver(d, "v2", "v1", 2);
  expect((await conflictedNotes(d, ["n1"])).size).toBe(0);
  await ver(d, "a", "v2", 3);
  await ver(d, "b", "v2", 4);
  expect([...(await conflictedNotes(d, ["n1", "other"]))]).toEqual(["n1"]);
  expect((await listVersions(d, "n1")).filter((v) => v.isHead).map((v) => v.id)).toEqual(["b", "a"]);
  expect(await nextParent(d, "n1")).toBe("a,b");
  await ver(d, "m", "a,b", 5);
  expect((await conflictedNotes(d, ["n1"])).size).toBe(0);
});

test("legacy versions with no parent chain by time and are not a conflict", async () => {
  const d = await open();
  await note(d);
  for (const [i, id] of ["v1", "v2", "v3"].entries()) await ver(d, id, null, i + 1);
  expect((await conflictedNotes(d, ["n1"])).size).toBe(0);
  expect(await nextParent(d, "n1")).toBe("v3");
});

test("retention keeps newest N, heads, pins, unsynced rows and conflicted notes whole", async () => {
  const d = await open();
  await note(d);
  await d.run("INSERT INTO entities VALUES ('t', 'thread', 1, 1, NULL, NULL)");
  await d.run("INSERT INTO threads VALUES ('t', 'T', 1, NULL)");
  await d.run("INSERT INTO entities VALUES ('m', 'message', 1, 1, NULL, NULL)");
  await d.run("INSERT INTO messages VALUES ('m', 't', 'n1', 'v03', 1, NULL, NULL)");
  for (let i = 1; i <= 12; i++) await ver(d, `v${String(i).padStart(2, "0")}`, i > 1 ? `v${String(i - 1).padStart(2, "0")}` : null, i);
  await d.run("UPDATE note_versions SET rev = 1 WHERE id != 'v02'"); // v02 never reached main
  expect(await pruneVersions(d, 5)).toBe(5); // v01, v04..v07 fall outside the newest 5; v03 is pinned, v02 unsynced
  expect(await ids(d)).toEqual(["v02", "v03", "v08", "v09", "v10", "v11", "v12"]);
  expect(await pruneVersions(d, 5)).toBe(0); // idempotent

  await ver(d, "x", "v12", 13);
  await ver(d, "y", "v12", 14);
  await d.run("UPDATE note_versions SET rev = 1");
  expect(await pruneVersions(d, 2)).toBe(0); // conflicted: nothing goes
});

test("a pruned version does not come back through a sync round trip", async () => {
  const main = await open();
  const phone = await open();
  await note(main);
  for (let i = 1; i <= 8; i++) await ver(main, `v${i}`, i > 1 ? `v${i - 1}` : null, i);
  await stampRevs(main);
  await applyChanges(phone, await changesSince(main, 0));
  const cursor = (await main.all<{ value: number }>("SELECT value FROM core_state WHERE key = 'rev'"))[0]?.value ?? 0;

  await pruneVersions(main, 3);
  await pruneVersions(phone, 3);
  expect(await ids(main)).toEqual(await ids(phone));
  expect(await ids(main)).toEqual(["v6", "v7", "v8"]);

  // phone edits (parent = head), pushes, main stamps; the pull carries only the new version.
  await ver(phone, "v9", "v8", 9);
  const { note_versions } = await pendingChanges(phone);
  await applyChanges(main, { note_versions });
  await stampRevs(main);
  const pulled = await changesSince(main, cursor);
  expect(pulled.note_versions.map((v) => v.id)).toEqual(["v9"]);
  await applyChanges(phone, pulled);
  await pruneVersions(main, 3);
  await pruneVersions(phone, 3);
  expect(await ids(main)).toEqual(["v7", "v8", "v9"]);
  expect(await ids(phone)).toEqual(["v7", "v8", "v9"]);
});


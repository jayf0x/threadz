import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import {
  applyChanges,
  type Changes,
  changesSince,
  countChanges,
  type Driver,
  initSchema,
  orderedMessageIds,
  pendingChanges,
  stampRevs,
  TABLE_NAMES,
} from "./index";

// The sync rules in docs/direction.md ("Sync"), exercised as one phone and one main.

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};

const dump = async (d: Driver) =>
  Promise.all(
    TABLE_NAMES.map(async (t) =>
      (await d.all<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY 1`)).map(({ rev: _r, ...r }) => r),
    ),
  );

const message = async (d: Driver, id: string, thread: string, text: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'note', ?, ?, NULL, NULL)", [`n-${id}`, at, at]);
  await d.run("INSERT INTO note_versions VALUES (?, ?, NULL, ?, 'user', ?, NULL)", [`v-${id}`, `n-${id}`, text, at]);
  await d.run("INSERT INTO entities VALUES (?, 'message', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO messages VALUES (?, ?, ?, NULL, ?, NULL, NULL)", [id, thread, `n-${id}`, at]);
};

// main: thread t1 with m1, m2; the phone pulled it all.
const seeded = async () => {
  const main = await open();
  await main.run("INSERT INTO entities VALUES ('t1', 'thread', 1, 1, NULL, NULL)");
  await main.run("INSERT INTO threads VALUES ('t1', 'Arya', 1, NULL)");
  await message(main, "m1", "t1", "Needle", 10);
  await message(main, "m2", "t1", "the wolf dream", 20);
  const cursor = await stampRevs(main);
  const phone = await open();
  await applyChanges(phone, await changesSince(main, 0));
  return { main, phone, cursor };
};

const sync = async (phone: Driver, main: Driver, cursor: number) => {
  await applyChanges(main, await pendingChanges(phone));
  await stampRevs(main);
  await applyChanges(phone, await changesSince(main, cursor));
};

test("a pulled phone matches main and has nothing pending", async () => {
  const { main, phone } = await seeded();
  expect(await dump(phone)).toEqual(await dump(main));
  expect(countChanges(await pendingChanges(phone))).toBe(0);
});

test("offline edits on both sides converge; a conflicting edit keeps both versions", async () => {
  const { main, phone, cursor } = await seeded();
  await phone.run("INSERT INTO note_versions VALUES ('vp', 'n-m1', 'v-m1', 'Needle (phone)', 'user', 60, NULL)");
  await phone.run("UPDATE threads SET title = 'Arya (phone)', updated_at = 61, rev = NULL WHERE id = 't1'");
  await main.run("INSERT INTO note_versions VALUES ('vm', 'n-m1', 'v-m1', 'Needle (main)', 'user', 65, NULL)");
  await main.run("UPDATE threads SET title = 'Arya (main)', updated_at = 60, rev = NULL WHERE id = 't1'");
  await stampRevs(main);
  await sync(phone, main, cursor);
  expect(await dump(phone)).toEqual(await dump(main));
  expect((await main.all<{ title: string }>("SELECT title FROM threads"))[0]?.title).toBe("Arya (phone)");
  expect(await main.all("SELECT id FROM note_versions WHERE parent_id = 'v-m1'")).toHaveLength(2);
  expect(countChanges(await pendingChanges(phone))).toBe(0);
});

test("content wins: a thread deleted on the phone returns if main added to it later", async () => {
  const { main, phone, cursor } = await seeded();
  await phone.run("UPDATE entities SET deleted_at = 70, updated_at = 70, rev = NULL WHERE id = 't1'");
  await message(main, "m3", "t1", "later idea", 75);
  await stampRevs(main);
  await sync(phone, main, cursor);
  expect(await dump(phone)).toEqual(await dump(main));
  expect(await main.all("SELECT id FROM entities WHERE id = 't1' AND deleted_at IS NULL")).toHaveLength(1);
});

test("order: appends never write it, a reorder does, stale ids are skipped on read", async () => {
  const { main } = await seeded();
  await message(main, "m3", "t1", "third", 30);
  expect(await orderedMessageIds(main, "t1")).toEqual(["m1", "m2", "m3"]);
  await main.run("INSERT INTO thread_order VALUES ('t1', '[\"m3\",\"gone\",\"m1\"]', 40, NULL)");
  await main.run("UPDATE messages SET removed_at = 41 WHERE id = 'm1'");
  expect(await orderedMessageIds(main, "t1")).toEqual(["m3", "m2"]);
});

test("untrusted keys in a pushed row never reach the SQL", async () => {
  const d = await open();
  const evil = { id: "x", kind: "note", created_at: 1, updated_at: 1, deleted_at: null, rev: null, "1); DROP TABLE threads; --": 1 };
  await applyChanges(d, { entities: [evil] } as unknown as Partial<Changes>);
  expect(await d.all("SELECT id FROM entities WHERE id = 'x'")).toHaveLength(1);
});

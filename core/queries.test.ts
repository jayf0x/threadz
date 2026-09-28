import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import { BUILTIN, initSchema } from "./schema";
import { annotationsFor, bin, pool, threadView, todos } from "./queries";

// The branching logic in the read queries (docs/direction.md, "Lenses"): live-vs-pinned version resolution,
// pool membership once a message is removed, Bin filtering, and a todo joined to its message's thread.

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};

const note = async (d: Awaited<ReturnType<typeof open>>, id: string, text: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'note', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO note_versions VALUES (?, ?, NULL, ?, 'user', ?, NULL)", [`v-${id}-${at}`, id, text, at]);
};

const placeMessage = async (
  d: Awaited<ReturnType<typeof open>>,
  id: string,
  threadId: string,
  noteId: string,
  at: number,
) => {
  await d.run("INSERT INTO entities VALUES (?, 'message', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO messages VALUES (?, ?, ?, NULL, ?, NULL, NULL)", [id, threadId, noteId, at]);
};

const thread = async (d: Awaited<ReturnType<typeof open>>, id: string, title: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'thread', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO threads VALUES (?, ?, ?, NULL)", [id, title, at]);
};

test("thread view resolves the live version, then the pinned one once set", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "first draft", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', ?, 'second draft', 'user', 20, NULL)", [`v-n1-10`]);

  expect((await threadView(d, "t1"))[0]?.version.content).toBe("second draft");

  await d.run("UPDATE messages SET pin_version_id = ? WHERE id = 'm1'", [`v-n1-10`]);
  expect((await threadView(d, "t1"))[0]?.version.content).toBe("first draft");
});

test("pool: a note joins the pool once its only message is removed", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "a loose idea", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);

  expect((await pool(d)).map((p) => p.entity_id)).not.toContain("n1");

  await d.run("UPDATE messages SET removed_at = 20 WHERE id = 'm1'");
  expect((await pool(d)).map((p) => p.entity_id)).toContain("n1");
});

test("bin: only deleted entities show, newest first", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await thread(d, "t2", "Sansa", 2);
  await d.run("UPDATE entities SET deleted_at = 30 WHERE id = 't1'");
  await d.run("UPDATE entities SET deleted_at = 40 WHERE id = 't2'");

  const rows = await bin(d);
  expect(rows.map((r) => r.id)).toEqual(["t2", "t1"]);
});

// Attaches note `noteId` to message `messageId`: a link entity plus a property_values row carrying the
// built-in `attached` value, exactly what `lib/data.ts`'s `addAnnotation` writes.
const attach = async (
  d: Awaited<ReturnType<typeof open>>,
  linkId: string,
  noteId: string,
  messageId: string,
  at: number,
) => {
  await d.run("INSERT INTO entities VALUES (?, 'link', ?, ?, NULL, NULL)", [linkId, at, at]);
  await d.run("INSERT INTO links VALUES (?, ?, ?, NULL, ?, NULL)", [linkId, noteId, messageId, at]);
  await d.run("INSERT INTO property_values VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)", [
    `pv-${linkId}`,
    BUILTIN.attached,
    linkId,
    at,
    at,
  ]);
};

test("annotationsFor: no attached notes in an empty or unattached thread", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "a loose idea", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);

  expect(await annotationsFor(d, "t1")).toEqual([]);
});

test("annotationsFor: a live attached note resolves to its note's live version", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await note(d, "note-1", "a side thought", 20);
  await attach(d, "link-1", "note-1", "m1", 20);

  const rows = await annotationsFor(d, "t1");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.message_id).toBe("m1");
  expect(rows[0]?.note_id).toBe("note-1");
  expect(rows[0]?.version.content).toBe("a side thought");
});

test("annotationsFor: a deleted (tombstoned) attached note is excluded", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await note(d, "note-1", "a side thought", 20);
  await attach(d, "link-1", "note-1", "m1", 20);
  await d.run("UPDATE entities SET deleted_at = 30 WHERE id = 'note-1'");

  expect(await annotationsFor(d, "t1")).toEqual([]);
});

test("todos: a todo on a message carries its thread and note content", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await d.run("INSERT INTO todos VALUES ('m1', 0, 15, NULL)");

  const rows = await todos(d);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.context).toEqual({ kind: "message", thread_id: "t1", note_content: "pack for winter" });
});

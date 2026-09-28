import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunDriver } from "./bun";
import { BUILTIN, initSchema } from "./schema";
import {
  annotationsFor,
  bin,
  counterValue,
  isReferenceStale,
  listLinks,
  pool,
  propertySets,
  propertyValuesFor,
  threadView,
  todos,
} from "./queries";

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

test("pool: a note placed in two threads only joins once every placement is removed", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await thread(d, "t2", "Sansa", 2);
  await note(d, "n1", "a loose idea", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await placeMessage(d, "m2", "t2", "n1", 11);

  await d.run("UPDATE messages SET removed_at = 20 WHERE id = 'm1'");
  expect((await pool(d)).map((p) => p.entity_id)).not.toContain("n1"); // still live in t2

  await d.run("UPDATE messages SET removed_at = 21 WHERE id = 'm2'");
  expect((await pool(d)).map((p) => p.entity_id)).toContain("n1"); // now unplaced everywhere

  await placeMessage(d, "m3", "t1", "n1", 30);
  expect((await pool(d)).map((p) => p.entity_id)).not.toContain("n1"); // re-placed, leaves the pool
});

test("pool: a note is never surfaced once its own entity is deleted", async () => {
  const d = await open();
  await note(d, "n1", "a loose idea", 10);
  expect((await pool(d)).map((p) => p.entity_id)).toContain("n1");

  await d.run("UPDATE entities SET deleted_at = 20 WHERE id = 'n1'");
  expect((await pool(d)).map((p) => p.entity_id)).not.toContain("n1");
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

// Property sets, values and the `counter` rule (docs/direction.md "C13"/"Rules are computed, not stored").

const propertySet = async (
  d: Awaited<ReturnType<typeof open>>,
  id: string,
  name: string,
  opts: { scopeThreadId?: string | null; rule?: "counter" | null } = {},
) => {
  await d.run("INSERT INTO entities VALUES (?, 'property_set', 0, 0, NULL, NULL)", [id]);
  await d.run("INSERT INTO property_sets VALUES (?, ?, 'none', ?, ?, NULL, 0, NULL)", [
    id,
    name,
    opts.scopeThreadId ?? null,
    opts.rule ?? null,
  ]);
};

const propertyValue = async (d: Awaited<ReturnType<typeof open>>, id: string, setId: string, targetId: string, at: number) =>
  d.run("INSERT INTO property_values VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)", [id, setId, targetId, at, at]);

test("propertyValuesFor: a value under a deleted (tombstoned) set is inert — no row comes back", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await propertySet(d, "ps1", "Chapter");
  await propertyValue(d, "pv1", "ps1", "m1", 10);

  expect(await propertyValuesFor(d, "m1")).toHaveLength(1);

  await d.run("UPDATE entities SET deleted_at = 20 WHERE id = 'ps1'");
  expect(await propertyValuesFor(d, "m1")).toEqual([]);
});

test("propertyValuesFor: a removed (tombstoned) value is excluded even if its set is live", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await propertySet(d, "ps1", "Chapter");
  await propertyValue(d, "pv1", "ps1", "m1", 10);
  await d.run("UPDATE property_values SET removed_at = 20 WHERE id = 'pv1'");

  expect(await propertyValuesFor(d, "m1")).toEqual([]);
});

test("propertySets: global sets always show; a thread-scoped set only shows for its own thread", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await thread(d, "t2", "Sansa", 2);
  await propertySet(d, "ps-global", "Character");
  await propertySet(d, "ps-t1", "Chapter", { scopeThreadId: "t1" });

  const builtinCount = 4; // attached, copied-from, source, local-only (core/schema.ts BUILTIN_SETS)
  expect((await propertySets(d)).map((s) => s.id)).toEqual(
    expect.arrayContaining(["ps-global"]),
  );
  expect(await propertySets(d)).toHaveLength(builtinCount + 1);
  expect((await propertySets(d, "t1")).map((s) => s.id)).toEqual(
    expect.arrayContaining(["ps-global", "ps-t1"]),
  );
  expect((await propertySets(d, "t2")).map((s) => s.id)).not.toContain("ps-t1");
});

test("counterValue: numbers only counter-set members, by their order in the thread, skipping non-members", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "one", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await note(d, "n2", "two", 20);
  await placeMessage(d, "m2", "t1", "n2", 20);
  await note(d, "n3", "three", 30);
  await placeMessage(d, "m3", "t1", "n3", 30);
  await propertySet(d, "ps-counter", "Chapter", { rule: "counter" });
  await propertyValue(d, "pv1", "ps-counter", "m1", 10);
  await propertyValue(d, "pv3", "ps-counter", "m3", 30);

  expect(await counterValue(d, "ps-counter", "m1")).toBe(1);
  expect(await counterValue(d, "ps-counter", "m2")).toBeNull(); // not a member
  expect(await counterValue(d, "ps-counter", "m3")).toBe(2); // second member, even though it's the third message

  // A non-counter set never numbers anything.
  await propertySet(d, "ps-plain", "Character");
  await propertyValue(d, "pv2", "ps-plain", "m2", 20);
  expect(await counterValue(d, "ps-plain", "m2")).toBeNull();
});

// References + staleness (docs/direction.md "C14"/"Versions": a pinned `tz:note/<id>@<version>`
// reference is stale once the note has moved past the version it points at).

test("isReferenceStale: false when the pin matches the latest version, true once a newer one lands", async () => {
  const d = await open();
  await note(d, "n1", "first draft", 10);
  const [v1] = await d.all<{ id: string }>("SELECT id FROM note_versions WHERE note_id = 'n1'");
  if (!v1) throw new Error("expected a version");

  expect(await isReferenceStale(d, "n1", v1.id)).toBe(false);

  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', ?, 'second draft', 'user', 20, NULL)", [v1.id]);
  expect(await isReferenceStale(d, "n1", v1.id)).toBe(true);
  expect(await isReferenceStale(d, "n1", "v2")).toBe(false);
});

test("isReferenceStale: a note with no versions at all is never stale", async () => {
  const d = await open();
  await d.run("INSERT INTO entities VALUES ('n-empty', 'note', 0, 0, NULL, NULL)");
  expect(await isReferenceStale(d, "n-empty", "some-version")).toBe(false);
});

test("listLinks: newest first, labelled by its type value or a plain fallback", async () => {
  const d = await open();
  await thread(d, "t1", "Arya", 1);
  await note(d, "n1", "pack for winter", 10);
  await placeMessage(d, "m1", "t1", "n1", 10);
  await note(d, "n2", "a side thought", 20);
  await d.run("INSERT INTO entities VALUES ('link-1', 'link', 20, 20, NULL, NULL)", []);
  await d.run("INSERT INTO links VALUES ('link-1', 'n2', 'm1', NULL, 20, NULL)");
  await d.run("INSERT INTO entities VALUES ('link-2', 'link', 30, 30, NULL, NULL)", []);
  await d.run("INSERT INTO links VALUES ('link-2', 'n1', 'm1', NULL, 30, NULL)");
  await propertySet(d, "ps-type", "Type");
  await propertyValue(d, "pv-type", "ps-type", "link-1", 20);
  await d.run("UPDATE property_values SET value = 'reference' WHERE id = 'pv-type'");

  const rows = await listLinks(d);
  expect(rows.map((r) => r.id)).toEqual(["link-2", "link-1"]); // newest updated_at first
  expect(rows.find((r) => r.id === "link-1")?.label).toBe("reference");
  expect(rows.find((r) => r.id === "link-2")?.label).toBe("Link"); // no property value at all

  await d.run("UPDATE entities SET deleted_at = 40 WHERE id = 'link-2'");
  expect((await listLinks(d)).map((r) => r.id)).toEqual(["link-1"]);
});

import { search as coreSearch, type Driver, orderedMessageIds, pool, threadView } from "@threadz/core";
import { emitChange } from "./changeSignal";
import { openPhoneDb } from "./phoneDb";
import type { Annotation, Message, Thread, Version } from "./types";

// The v2 frozen contract (docs/direction.md "Data model" + "Sync"): a thin async facade over one
// shared `phoneDb` instance and `core`'s query functions, exposing what the app's hooks need.
// Every write goes straight through `core`'s `Driver` — INSERT/UPDATE against the tables in
// core/schema.ts — and calls `emitChange()` when it lands, per lib/changeSignal.ts. There is no
// "live"/"local" duality any more: the phone always reads and writes this database; main is a pure
// sync target (`syncEngine.ts`).

let dbPromise: ReturnType<typeof openPhoneDb> | null = null;

// Exposed for syncEngine.ts (push/pull needs the same driver + db handle) and DataSection's
// export/import, which touch the raw `.sqlite` file rather than going through queries.
export const getPhoneDb = () => {
  if (!dbPromise) dbPromise = openPhoneDb();
  return dbPromise;
};

const driver = async (): Promise<Driver> => (await getPhoneDb()).driver;

const uuid = () => crypto.randomUUID();

// --- reading -------------------------------------------------------------------------------

export const listThreads = async (): Promise<Thread[]> => {
  const d = await driver();
  const rows = await d.all<{ id: string; title: string; created_at: number; updated_at: number }>(
    `SELECT t.id, t.title, e.created_at, t.updated_at FROM threads t
     JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL
     ORDER BY t.updated_at DESC`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
};

export const getThread = async (id: string): Promise<Thread | null> => {
  const d = await driver();
  const [row] = await d.all<{ id: string; title: string; created_at: number; updated_at: number }>(
    `SELECT t.id, t.title, e.created_at, t.updated_at FROM threads t
     JOIN entities e ON e.id = t.id WHERE t.id = ? AND e.deleted_at IS NULL`,
    [id],
  );
  return row ? { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at } : null;
};

// A note's other, earlier versions (oldest first) plus whether the newest one counts as "edited"
// (more than one version ever written). N+1 queries — fine at POC scale; the frozen `threadView`
// query intentionally returns only the live/pinned version, so history is fetched alongside it here.
const versionHistory = async (d: Driver, noteId: string, currentId: string) => {
  const rows = await d.all<{ id: string; content: string; created_at: number }>(
    "SELECT id, content, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at, id",
    [noteId],
  );
  const edits: Version[] = rows
    .filter((r) => r.id !== currentId)
    .map((r) => ({ content: r.content, at: r.created_at }));
  const editedAt = edits.length ? (rows.at(-1)?.created_at ?? null) : null;
  return { edits, editedAt };
};

const todoFor = async (d: Driver, targetId: string) => {
  const [row] = await d.all<{ done: number; updated_at: number }>(
    "SELECT done, updated_at FROM todos WHERE target_id = ?",
    [targetId],
  );
  return row
    ? { meta: { todo: { done: !!row.done } }, metaEditedAt: row.updated_at }
    : { meta: null, metaEditedAt: null };
};

// A thread's messages, oldest first, in the shape `EntryRow`/`lib/todos.ts`/`lib/versions.ts`
// already expect (see lib/types.ts's `Message` for why it stays close to v1's shape). `seq` is
// derived from `orderedMessageIds`'s position, replacing v1's stored column.
export const threadMessages = async (threadId: string): Promise<Message[]> => {
  const d = await driver();
  const rows = await threadView(d, threadId);
  const out: Message[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const { message, version } = row;
    const [entity] = await d.all<{ created_at: number }>("SELECT created_at FROM entities WHERE id = ?", [message.id]);
    const { edits, editedAt } = await versionHistory(d, message.note_id, version.id);
    const { meta, metaEditedAt } = await todoFor(d, message.id);
    out.push({
      id: message.id,
      threadId: message.thread_id,
      role: version.author,
      content: version.content,
      createdAt: entity?.created_at ?? version.created_at,
      seq: i + 1,
      meta,
      editedAt,
      edits,
      metaEditedAt,
    });
  }
  return out;
};

// Every thread's messages, flattened — what a cross-thread scan (References autocomplete's local
// search, the Todos lens's `/todo` line scan) needs in place of v1's `exportSnapshot`. There is no
// JSON snapshot any more (direction.md's "Device storage and export": a full device backup is now
// the phone's own `.sqlite` bytes, via `phoneDb.dump()`/`exportFile()`), so this is a plain live read.
export const allMessages = async (): Promise<{ threads: Thread[]; messages: Message[] }> => {
  const threads = await listThreads();
  const messages: Message[] = [];
  for (const t of threads) messages.push(...(await threadMessages(t.id)));
  return { threads, messages };
};

// Which of a thread's live messages have a row (the placement itself, or its note's newest version)
// still waiting for main to stamp a `rev` — replaces v1's per-message `dirty` flag for the "only on
// this device so far" cloud-off icon (EntryRow.tsx).
export const pendingMessageIds = async (threadId: string): Promise<Set<string>> => {
  const d = await driver();
  const rows = await d.all<{ id: string }>(
    `SELECT m.id FROM messages m
     LEFT JOIN note_versions v ON v.note_id = m.note_id
       AND v.created_at = (SELECT MAX(v2.created_at) FROM note_versions v2 WHERE v2.note_id = m.note_id)
     WHERE m.thread_id = ? AND (m.rev IS NULL OR v.rev IS NULL)`,
    [threadId],
  );
  return new Set(rows.map((r) => r.id));
};

export type PoolItem = { entityId: string; createdAt: number; content: string };

export const listPool = async (): Promise<PoolItem[]> => {
  const d = await driver();
  const rows = await pool(d);
  return rows.map((r) => ({ entityId: r.entity_id, createdAt: r.created_at, content: r.version.content }));
};

export type BinItem = { id: string; kind: "thread" | "note"; title: string; deletedAt: number };

// The Bin (docs/direction.md "C11"): threads and notes with `deleted_at` set — a deleted message is
// only ever the cascade side-effect of one of those two (see `deleteThread`/`deleteNote`), so it's
// filtered out here rather than shown as its own confusing row. `title` is the thread's own title,
// or a snippet of the note's latest content.
export const listBin = async (): Promise<BinItem[]> => {
  const d = await driver();
  const rows = await d.all<{ id: string; kind: string; deleted_at: number }>(
    "SELECT id, kind, deleted_at FROM entities WHERE deleted_at IS NOT NULL AND kind IN ('thread', 'note') ORDER BY deleted_at DESC",
  );
  const out: BinItem[] = [];
  for (const r of rows) {
    if (r.kind === "thread") {
      const [t] = await d.all<{ title: string }>("SELECT title FROM threads WHERE id = ?", [r.id]);
      out.push({ id: r.id, kind: "thread", title: t?.title ?? "Untitled thread", deletedAt: r.deleted_at });
    } else {
      const [v] = await d.all<{ content: string }>(
        "SELECT content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        [r.id],
      );
      out.push({
        id: r.id,
        kind: "note",
        title: (v?.content ?? "").slice(0, 80) || "Empty note",
        deletedAt: r.deleted_at,
      });
    }
  }
  return out;
};

// Thread ids matching `query`, ranked by `core.search`'s order (title hits and note-content hits
// alike, notes resolved back to the thread(s) they're currently placed in).
export const searchThreadIds = async (query: string): Promise<string[]> => {
  const d = await driver();
  const hits = await coreSearch(d, query);
  const ids: string[] = [];
  for (const h of hits) {
    if (h.kind === "thread") {
      ids.push(h.thread_id);
      continue;
    }
    const rows = await d.all<{ thread_id: string }>(
      `SELECT DISTINCT m.thread_id FROM messages m JOIN entities e ON e.id = m.id
       WHERE m.note_id = ? AND m.removed_at IS NULL AND e.deleted_at IS NULL`,
      [h.entity_id],
    );
    for (const r of rows) ids.push(r.thread_id);
  }
  return [...new Set(ids)];
};

// --- writing ---------------------------------------------------------------------------------

const now = () => Date.now();

const insertEntity = (d: Driver, id: string, kind: string, at: number) =>
  d.run("INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, ?, ?, ?, NULL, NULL)", [
    id,
    kind,
    at,
    at,
  ]);

const touchThread = (d: Driver, threadId: string, at: number) =>
  Promise.all([
    d.run("UPDATE threads SET updated_at = ? WHERE id = ?", [at, threadId]),
    d.run("UPDATE entities SET updated_at = ? WHERE id = ?", [at, threadId]),
  ]);

// Places a brand-new note as the message at position `at` (a plain timestamp — order is derived
// from `created_at` per core/merge.ts's `orderedMessageIds`, so distinct `at`s keep insertion order
// even within one tight loop, e.g. `copyThread` below).
const placeNewNote = async (d: Driver, threadId: string, content: string, author: "user" | "assistant", at: number) => {
  const noteId = uuid();
  const versionId = uuid();
  const messageId = uuid();
  await insertEntity(d, noteId, "note", at);
  await d.run(
    "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
    [versionId, noteId, content, author, at],
  );
  await insertEntity(d, messageId, "message", at);
  await d.run(
    "INSERT INTO messages (id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, NULL, NULL)",
    [messageId, threadId, noteId, at],
  );
  return { noteId, messageId };
};

export const createThread = async (title: string): Promise<Thread> => {
  const d = await driver();
  const id = uuid();
  const at = now();
  await d.tx(async () => {
    await insertEntity(d, id, "thread", at);
    await d.run("INSERT INTO threads (id, title, updated_at, rev) VALUES (?, ?, ?, NULL)", [id, title, at]);
  });
  emitChange();
  return { id, title, createdAt: at, updatedAt: at };
};

export const renameThread = async (id: string, title: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?", [title, at, id]);
    await d.run("UPDATE entities SET updated_at = ? WHERE id = ?", [at, id]);
  });
  emitChange();
};

// Appends a note as the newest message in a thread — never touches `thread_order` (an append can
// never conflict with a reorder, per core/merge.ts).
export const appendNote = async (
  threadId: string,
  content: string,
  author: "user" | "assistant" = "user",
): Promise<string> => {
  const d = await driver();
  const at = now();
  const { messageId } = await d.tx(async () => {
    const r = await placeNewNote(d, threadId, content, author, at);
    await touchThread(d, threadId, at);
    return r;
  });
  emitChange();
  return messageId;
};

// An edit is a new `note_versions` row (docs/direction.md "Versions"), never an update to an
// existing one — immutable rows are insert-if-missing on sync.
export const editMessage = async (messageId: string, content: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [row] = await d.all<{ note_id: string; thread_id: string; author: string }>(
    `SELECT m.note_id, m.thread_id, v.author FROM messages m
     JOIN note_versions v ON v.note_id = m.note_id
     WHERE m.id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 1`,
    [messageId],
  );
  if (!row) throw new Error(`message ${messageId} not found`);
  await d.tx(async () => {
    await d.run(
      "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
      [uuid(), row.note_id, content, row.author, at],
    );
    await d.run("UPDATE messages SET updated_at = ? WHERE id = ?", [at, messageId]);
    await touchThread(d, row.thread_id, at);
  });
  emitChange();
};

// Remove a message from a thread (docs/direction.md "C11"): a tombstone on the *message* row
// (`removed_at`), never the note's own entity — the note goes to the Pool automatically the moment
// no live message points at it (see core/queries.ts's `pool`), and stays exactly where it is if it's
// still placed somewhere else.
export const removeMessage = async (messageId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [row] = await d.all<{ thread_id: string }>("SELECT thread_id FROM messages WHERE id = ?", [messageId]);
  await d.tx(async () => {
    await d.run("UPDATE messages SET removed_at = ?, updated_at = ? WHERE id = ?", [at, at, messageId]);
    if (row) await touchThread(d, row.thread_id, at);
  });
  emitChange();
};

// Delete a thread (C11): the thread entity and every one of its messages tombstone together,
// restorable as one Bin entry. Notes left with no other placement surface in the Pool, not the Bin.
export const deleteThread = async (threadId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, threadId]);
    const rows = await d.all<{ id: string }>("SELECT id FROM messages WHERE thread_id = ?", [threadId]);
    for (const r of rows)
      await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, r.id]);
  });
  emitChange();
};

// Delete a note placed in several threads (C11): the note gets `deleted_at`, and every message
// that placed it (in any thread) tombstones with it — disappears everywhere at once, one Bin entry.
export const deleteNote = async (noteId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, noteId]);
    const rows = await d.all<{ id: string }>("SELECT id FROM messages WHERE note_id = ?", [noteId]);
    for (const r of rows)
      await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, r.id]);
  });
  emitChange();
};

// The Bin's one Undo: the exact inverse of the two deletes above, dispatched on the entity's own
// `kind` (Bin rows already carry it — see `listBin`).
export const restoreFromBin = async (id: string, kind: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ?", [at, id]);
    const col = kind === "thread" ? "thread_id" : kind === "note" ? "note_id" : null;
    if (!col) return;
    const rows = await d.all<{ id: string }>(`SELECT id FROM messages WHERE ${col} = ?`, [id]);
    for (const r of rows) await d.run("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ?", [at, r.id]);
  });
  emitChange();
};

// `null` clears the flag entirely (no `todos` row at all, so it drops out of the Todos lens);
// `true`/`false` upserts it. There's no soft-delete column on `todos` in core/schema.ts, so
// clearing is a real DELETE — acceptable for one phone/one main; sync just never sees the row again.
export const setTodo = async (targetId: string, done: boolean | null): Promise<void> => {
  const d = await driver();
  const at = now();
  if (done === null) await d.run("DELETE FROM todos WHERE target_id = ?", [targetId]);
  else
    await d.run(
      `INSERT INTO todos (target_id, done, updated_at, rev) VALUES (?, ?, ?, NULL)
       ON CONFLICT(target_id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at, rev = NULL`,
      [targetId, done ? 1 : 0, at],
    );
  emitChange();
};

// "Clone from here" (AGENTS.md's Composer/EntryRow ⋯ menu): a new thread holding a *copy* of A's
// messages up to and including `uptoMessageId` (docs/direction.md "Versions": a copy is a new note,
// never a reference) plus, optionally, one more note appended after them.
export const copyThread = async (threadId: string, uptoMessageId: string, appendContent?: string): Promise<Thread> => {
  const d = await driver();
  const ids = await orderedMessageIds(d, threadId);
  const cut = ids.indexOf(uptoMessageId);
  const keep = cut >= 0 ? ids.slice(0, cut + 1) : ids;
  const [src] = await d.all<{ title: string }>("SELECT title FROM threads WHERE id = ?", [threadId]);
  const newId = uuid();
  const at0 = now();
  await d.tx(async () => {
    await insertEntity(d, newId, "thread", at0);
    await d.run("INSERT INTO threads (id, title, updated_at, rev) VALUES (?, ?, ?, NULL)", [
      newId,
      `Copy: ${src?.title ?? "Untitled"}`.slice(0, 200),
      at0,
    ]);
    let at = at0;
    for (const id of keep) {
      const [row] = await d.all<{ content: string; author: "user" | "assistant" }>(
        `SELECT v.content, v.author FROM messages m JOIN note_versions v ON v.note_id = m.note_id
         WHERE m.id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 1`,
        [id],
      );
      if (!row) continue;
      at += 1;
      await placeNewNote(d, newId, row.content, row.author, at);
    }
    const extra = appendContent?.trim();
    if (extra) {
      at += 1;
      await placeNewNote(d, newId, extra, "user", at);
    }
  });
  emitChange();
  return { id: newId, title: `Copy: ${src?.title ?? "Untitled"}`.slice(0, 200), createdAt: at0, updatedAt: at0 };
};

// NOT built yet (see lib/types.ts's `Annotation` comment): the `attached`-link lens that would back
// a real note-on-a-message. Every call site gets back "nothing", not a partial fake.
export const annotationsFor = async (_messageId: string): Promise<Annotation[]> => [];

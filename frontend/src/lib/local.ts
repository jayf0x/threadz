import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Api } from "./api";
import { ApiError } from "./errors";
import type { Message, Snapshot, SyncResult, Thread, Unsynced } from "./types";
import { bySeq, mergeMessage, versionsOf } from "./versions";

// The device's own database. Unlike the `threadz` mirror (lib/db.ts) this is
// AUTHORITATIVE while in local mode and is never cleared wholesale: every write
// is one transaction, and the only thing that ever deletes rows is an explicit
// user delete (which keeps a copy in `trash`).
//
// `dirty: 1` = not yet on the backend (this IS the local diff). `base` = main's
// per-thread hash as of the last time this device and main agreed on that thread;
// comparing it with main's current hashes tells us what main changed meanwhile.
type Dirty = { dirty: 0 | 1 };
type LThread = Thread & Dirty;
type LMessage = Message & Dirty;
type Trashed = { id: string; thread: Thread; messages: Message[]; deletedAt: number } & Dirty;
type Backup = { id: number; reason: string; json: string };

interface LocalDB extends DBSchema {
  threads: { key: string; value: LThread; indexes: { dirty: number } };
  messages: { key: string; value: LMessage; indexes: { byThread: string; dirty: number } };
  trash: { key: string; value: Trashed; indexes: { dirty: number } };
  backups: { key: number; value: Backup };
  base: { key: string; value: { id: string; hash: string } };
}

let dbp: Promise<IDBPDatabase<LocalDB>> | null = null;

const getDB = () => {
  dbp ??= openDB<LocalDB>("threadz-local", 2, {
    upgrade(db, old) {
      if (old < 1) {
        db.createObjectStore("threads", { keyPath: "id" }).createIndex("dirty", "dirty");
        const m = db.createObjectStore("messages", { keyPath: "id" });
        m.createIndex("byThread", "threadId");
        m.createIndex("dirty", "dirty");
        db.createObjectStore("trash", { keyPath: "id" }).createIndex("dirty", "dirty");
        db.createObjectStore("backups", { keyPath: "id" });
      }
      if (old < 2) db.createObjectStore("base", { keyPath: "id" });
    },
  });
  return dbp;
};

// The note a thread is created with gets an id derived from the thread's, so main and the device
// agree on it: a create whose reply was lost and is retried here dedupes at sync instead of doubling the seed.
export const seedId = (threadId: string) => `seed-${threadId}`;

const strip = <T extends Dirty>({ dirty, ...rest }: T): Omit<T, "dirty"> => rest;
const notFound = () => new ApiError(404, "thread not found");

// --- the Api, backed by IndexedDB --------------------------------------------

export const localApi: Api = {
  health: async () => ({ ok: true, model: "local" }),

  listThreads: async (q, sort = "updated") => {
    const db = await getDB();
    let threads = (await db.getAll("threads")).map(strip);
    const needle = q?.trim().toLowerCase();
    if (needle) {
      // v1 dropped generated description/tags from search (weak output, no UI for it) — titles and note text only.
      const hit = new Set(
        (await db.getAll("messages")).filter((m) => m.content.toLowerCase().includes(needle)).map((m) => m.threadId),
      );
      threads = threads.filter((t) => hit.has(t.id) || t.title.toLowerCase().includes(needle));
    }
    if (sort === "title") return threads.sort((a, b) => a.title.localeCompare(b.title));
    return threads.sort((a, b) => (sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
  },

  createThread: async ({ title, seed, id = crypto.randomUUID(), createdAt }) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "messages"], "readwrite");
    const existing = await tx.objectStore("threads").get(id);
    if (existing) return strip(existing); // idempotent, same as the backend
    const ts = createdAt ?? Date.now();
    const thread: LThread = {
      id,
      title: (title || "Untitled thread").slice(0, 200),
      createdAt: ts,
      updatedAt: ts,
      renamedAt: null,
      description: null,
      tags: [],
      hasEmbedding: false,
      dirty: 1,
    };
    await tx.objectStore("threads").put(thread);
    if (seed?.trim()) {
      const m: LMessage = {
        id: seedId(id),
        threadId: id,
        role: "user",
        content: seed.trim(),
        createdAt: ts,
        seq: 1,
        meta: null,
        dirty: 1,
      };
      await tx.objectStore("messages").put(m);
    }
    await tx.done;
    return strip(thread);
  },

  getThread: async (id) => {
    const db = await getDB();
    const thread = await db.get("threads", id);
    if (!thread) throw notFound();
    const messages = await db.getAllFromIndex("messages", "byThread", id);
    return { thread: strip(thread), messages: messages.sort(bySeq).map(strip) };
  },

  renameThread: async (id, title) => {
    const clean = title?.trim().slice(0, 200);
    if (!clean) throw new ApiError(400, "title is required");
    const db = await getDB();
    const tx = db.transaction("threads", "readwrite");
    const thread = await tx.store.get(id);
    if (!thread) throw notFound();
    const at = Date.now();
    const renamed: LThread = {
      ...thread,
      title: clean,
      renamedAt: at,
      updatedAt: Math.max(thread.updatedAt, at),
      dirty: 1,
    };
    await tx.store.put(renamed);
    await tx.done;
    return strip(renamed);
  },

  deleteThread: async (id) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "messages", "trash"], "readwrite");
    const thread = await tx.objectStore("threads").get(id);
    if (!thread) throw notFound();
    const rows = await tx.objectStore("messages").index("byThread").getAll(id);
    // Copy first, delete second, same transaction: either both happen or neither.
    await tx.objectStore("trash").put({
      id,
      thread: strip(thread),
      messages: rows.map(strip),
      deletedAt: Date.now(),
      dirty: 1, // ponytail: always tell the backend; a 404 there is fine
    });
    for (const m of rows) await tx.objectStore("messages").delete(m.id);
    await tx.objectStore("threads").delete(id);
    await tx.done;
    return { ok: true };
  },

  appendMessage: async (threadId, { id, role = "user", content, meta, createdAt }) => {
    const text = content?.trim();
    if (!id || !text) throw new ApiError(400, "id and content are required");
    const db = await getDB();
    const tx = db.transaction(["threads", "messages"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    if (!thread) throw notFound();
    const existing = await tx.objectStore("messages").get(id);
    if (existing) return { message: strip(existing), inserted: false };
    const seq =
      (await tx.objectStore("messages").index("byThread").getAll(threadId)).reduce((n, m) => Math.max(n, m.seq), 0) + 1;
    const ts = createdAt ?? Date.now();
    const message: LMessage = {
      id,
      threadId,
      role,
      content: text,
      createdAt: ts,
      seq,
      meta: (meta as Record<string, unknown> | null | undefined) ?? null,
      dirty: 1,
    };
    await tx.objectStore("messages").put(message);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, ts) });
    await tx.done;
    return { message: strip(message), inserted: true };
  },

  editMessage: async (threadId, id, content) => {
    const text = content?.trim();
    if (!text) throw new ApiError(400, "content is required");
    const db = await getDB();
    const tx = db.transaction(["threads", "messages"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const old = await tx.objectStore("messages").get(id);
    if (!thread || !old || old.threadId !== threadId) throw notFound();
    if (text === old.content) return { message: strip(old) };
    const at = Date.now();
    const message: LMessage = {
      ...old,
      ...mergeMessage(old, { ...old, content: text, editedAt: at, edits: versionsOf(old) }),
      dirty: 1,
    };
    await tx.objectStore("messages").put(message);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, at) });
    await tx.done;
    return { message: strip(message) };
  },

  // No Claude on the device. Local mode is capture-only; the UI does not offer Ask.
  ask: async () => {
    throw new ApiError(503, "Claude needs the main backend — go live to ask.");
  },
};

// --- sync bookkeeping ---------------------------------------------------------

export const countUnsynced = async (): Promise<Unsynced> => {
  const db = await getDB();
  const [threads, messages, deletions] = await Promise.all([
    db.countFromIndex("threads", "dirty", 1),
    db.countFromIndex("messages", "dirty", 1),
    db.countFromIndex("trash", "dirty", 1),
  ]);
  return { threads, messages, deletions };
};

export const unsyncedMessageIds = async (threadId: string) => {
  const rows = await (await getDB()).getAllFromIndex("messages", "byThread", threadId);
  return new Set(rows.filter((m) => m.dirty).map((m) => m.id));
};

// Everything a sync must push, in the order it must be pushed.
export const unsyncedBatch = async () => {
  const db = await getDB();
  const messages = (await db.getAllFromIndex("messages", "dirty", 1)).sort(
    (a, b) => a.threadId.localeCompare(b.threadId) || bySeq(a, b),
  );
  return {
    threads: await db.getAllFromIndex("threads", "dirty", 1),
    messages,
    trash: await db.getAllFromIndex("trash", "dirty", 1),
  };
};

export const localMessageIds = async (threadId: string) =>
  new Set((await (await getDB()).getAllFromIndex("messages", "byThread", threadId)).map((m) => m.id));

export const getBase = async () =>
  Object.fromEntries((await (await getDB()).getAll("base")).map((b) => [b.id, b.hash])) as Record<string, string>;

type Batch = Awaited<ReturnType<typeof unsyncedBatch>>;

// After main acknowledged a push: flip what was sent to clean, in ONE transaction. Each row is
// re-read and compared, on the fields that were sent, with the copy that was sent: one renamed or
// edited during the round-trip stays dirty for the next round instead of being marked clean by mistake.
// `missing`/`kept` rows stay dirty too.
export const commitPush = async (sent: Batch, r: SyncResult) => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "trash", "base"], "readwrite");
  const missing = new Set(r.missing);
  for (const t of sent.threads) {
    const row = await tx.objectStore("threads").get(t.id);
    if (row && sameThread(row, t)) await tx.objectStore("threads").put({ ...row, dirty: 0 });
  }
  for (const m of sent.messages) {
    if (missing.has(m.threadId)) continue;
    const row = await tx.objectStore("messages").get(m.id);
    if (row && sameMessage(row, m)) await tx.objectStore("messages").put({ ...row, dirty: 0 });
  }
  for (const x of sent.trash) {
    const row = await tx.objectStore("trash").get(x.id);
    if (row && row.deletedAt === x.deletedAt) await tx.objectStore("trash").put({ ...row, dirty: 0 });
    if (r.deleted.includes(x.id)) await tx.objectStore("base").delete(x.id);
    // r.kept: main changed since our base. Leave base stale — the next pull sees the mismatch and resurrects the thread.
  }
  await tx.done;
};

// What /api/sync carries for a thread / a note; another field changing (updatedAt) is no reason to resend.
const sameThread = (a: Thread, b: Thread) => a.title === b.title && (a.renamedAt ?? null) === (b.renamedAt ?? null);
const sameMessage = (a: Message, b: Message) =>
  a.content === b.content &&
  (a.editedAt ?? null) === (b.editedAt ?? null) &&
  JSON.stringify(a.edits ?? []) === JSON.stringify(b.edits ?? []);

// Something we thought main had, it doesn't: make it a pending change again.
export const markDirty = async (messageIds: string[]) => {
  const db = await getDB();
  const tx = db.transaction("messages", "readwrite");
  for (const id of messageIds) {
    const row = await tx.store.get(id);
    if (row) await tx.store.put({ ...row, dirty: 1 });
  }
  await tx.done;
};

// --- pulling main's changes into the device copy ------------------------------

// Union main's version of a thread into ours. Never drops a local note; a thread we
// deleted but main changed comes back ("content wins"), along with our own notes.
export const mergeRemoteThread = async (thread: Thread, messages: Message[], hash: string | undefined) => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "trash", "base"], "readwrite");
  const trashed = await tx.objectStore("trash").get(thread.id);
  if (trashed) await tx.objectStore("trash").delete(thread.id);
  const have = await tx.objectStore("threads").get(thread.id);
  if (!have?.dirty) await tx.objectStore("threads").put({ ...thread, dirty: 0 });
  // A pending local rename stays unless main renamed it more recently.
  else if ((thread.renamedAt ?? 0) > (have.renamedAt ?? 0))
    await tx.objectStore("threads").put({ ...have, title: thread.title, renamedAt: thread.renamedAt });
  let added = 0;
  for (const m of messages) {
    const mine = await tx.objectStore("messages").get(m.id);
    if (!mine) {
      await tx.objectStore("messages").put({ ...m, dirty: 0 });
      added++;
      continue;
    }
    // Same note edited on both sides: newest text wins, the other stays in its history.
    const merged = mergeMessage(mine, m);
    const same = (x: Message) =>
      x.content === merged.content &&
      (x.editedAt ?? null) === merged.editedAt &&
      (x.edits?.length ?? 0) === merged.edits?.length;
    if (!same(m))
      await tx.objectStore("messages").put({ ...merged, dirty: 1 }); // main lacks something we hold
    else if (!same(mine)) await tx.objectStore("messages").put({ ...merged, dirty: 0 });
  }
  const mainIds = new Set(messages.map((m) => m.id));
  for (const m of trashed?.messages ?? []) {
    if (!mainIds.has(m.id) && !(await tx.objectStore("messages").get(m.id)))
      await tx.objectStore("messages").put({ ...m, dirty: 1 }); // our notes from before the delete
  }
  if (hash) await tx.objectStore("base").put({ id: thread.id, hash });
  await tx.done;
  return { added, resurrected: !!trashed };
};

// Main deleted a thread we last saw. Clean copy → follow (kept in trash). Edited here
// → keep it and re-send everything so main gets the whole thread back.
export const applyRemoteDelete = async (id: string): Promise<"removed" | "kept" | "none"> => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "trash", "base"], "readwrite");
  await tx.objectStore("base").delete(id);
  const thread = await tx.objectStore("threads").get(id);
  if (!thread) {
    const t = await tx.objectStore("trash").get(id); // deleted on both sides
    if (t?.dirty) await tx.objectStore("trash").put({ ...t, dirty: 0 });
    await tx.done;
    return "none";
  }
  const rows = await tx.objectStore("messages").index("byThread").getAll(id);
  if (thread.dirty || rows.some((m) => m.dirty)) {
    await tx.objectStore("threads").put({ ...thread, dirty: 1 });
    for (const m of rows) await tx.objectStore("messages").put({ ...m, dirty: 1 });
    await tx.done;
    return "kept";
  }
  await tx
    .objectStore("trash")
    .put({ id, thread: strip(thread), messages: rows.map(strip), deletedAt: Date.now(), dirty: 0 });
  for (const m of rows) await tx.objectStore("messages").delete(m.id);
  await tx.objectStore("threads").delete(id);
  await tx.done;
  return "removed";
};

// Fresh tags/description from main's list (they're generated there, after the hash was taken).
export const updateMeta = async (threads: Thread[]) => {
  const db = await getDB();
  const tx = db.transaction("threads", "readwrite");
  for (const t of threads) {
    const have = await tx.store.get(t.id);
    if (have && !have.dirty)
      await tx.store.put({
        ...have,
        description: t.description,
        tags: t.tags,
        hasEmbedding: t.hasEmbedding,
        updatedAt: Math.max(have.updatedAt, t.updatedAt),
      });
  }
  await tx.done;
};

// --- snapshots: adopt from backend, import from file, export, backup ---------

// Import: union merge that NEVER overwrites a row the device has and never deletes.
// New rows are marked as pending so they sync; a thread deleted here comes back if the file has it,
// together with the notes we trashed that the file lacks. A note whose `seq` is already taken in its
// thread gets the next free one, so an import never produces two notes at the same position.
export const mergeSnapshot = async (snap: Snapshot) => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "trash"], "readwrite");
  const added = { threads: 0, messages: 0 };
  const used = new Map<string, Set<number>>(); // seqs in use per thread, loaded on first touch
  const place = async (m: Message) => {
    let seqs = used.get(m.threadId);
    if (!seqs) {
      seqs = new Set((await tx.objectStore("messages").index("byThread").getAll(m.threadId)).map((x) => x.seq));
      used.set(m.threadId, seqs);
    }
    const seq = seqs.has(m.seq) ? Math.max(0, ...seqs) + 1 : m.seq;
    seqs.add(seq);
    await tx.objectStore("messages").put({ ...m, seq, dirty: 1 });
    added.messages++;
  };
  const ours: Message[] = []; // our own trashed notes of a thread the file brings back, placed after the file's
  for (const t of snap.threads) {
    if (await tx.objectStore("threads").get(t.id)) continue;
    await tx.objectStore("threads").put({ ...t, dirty: 1 });
    added.threads++;
    const trashed = await tx.objectStore("trash").get(t.id);
    if (!trashed) continue;
    await tx.objectStore("trash").delete(t.id);
    ours.push(...trashed.messages);
  }
  for (const m of [...snap.messages].sort(bySeq)) {
    if (!(await tx.objectStore("threads").get(m.threadId))) continue;
    if (await tx.objectStore("messages").get(m.id)) continue;
    await place(m);
  }
  for (const m of ours.sort(bySeq)) if (!(await tx.objectStore("messages").get(m.id))) await place(m);
  await tx.done;
  return added;
};

// A backup file is untrusted: check the type of every field the app reads (search calls string methods on
// them, sync sends them), not just that the keys exist. Returns the snapshot, or null if any row is malformed.
export const parseSnapshot = (raw: unknown): Snapshot | null => {
  const rec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x: unknown) => typeof x === "string";
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const opt = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || x === null || ok(x);
  const versions = (x: unknown) => Array.isArray(x) && x.every((v) => rec(v) && str(v.content) && num(v.at));
  const thread = (t: unknown) =>
    rec(t) &&
    str(t.id) &&
    str(t.title) &&
    num(t.createdAt) &&
    num(t.updatedAt) &&
    Array.isArray(t.tags) &&
    t.tags.every(str) &&
    opt(t.description, str) &&
    opt(t.renamedAt, num);
  const message = (m: unknown) =>
    rec(m) &&
    str(m.id) &&
    str(m.threadId) &&
    str(m.content) &&
    num(m.createdAt) &&
    num(m.seq) &&
    (m.role === "user" || m.role === "assistant") &&
    opt(m.meta, rec) &&
    opt(m.editedAt, num) &&
    (m.edits === undefined || versions(m.edits));
  if (!rec(raw) || raw.version !== 1 || !Array.isArray(raw.threads) || !Array.isArray(raw.messages)) return null;
  if (!raw.threads.every(thread) || !raw.messages.every(message)) return null;
  return raw as Snapshot;
};

// Text only. Photos live in their own database (lib/images.ts) that nothing here — export, backup,
// import — ever touches, so an image can never enter a snapshot.
export const exportSnapshot = async (): Promise<Snapshot> => {
  const db = await getDB();
  return {
    version: 1,
    exportedAt: Date.now(),
    threads: (await db.getAll("threads")).map(strip),
    messages: (await db.getAll("messages")).map(strip),
    trash: (await db.getAll("trash")).map(({ thread, messages, deletedAt }) => ({ thread, messages, deletedAt })),
  };
};

const KEEP_BACKUPS = 5;

// Rolling in-database safety copy, taken before every sync. (It shares the
// database's fate if the browser evicts storage — Export is the off-device copy.)
export const saveBackup = async (reason: string) => {
  const db = await getDB();
  await db.put("backups", { id: Date.now(), reason, json: JSON.stringify(await exportSnapshot()) });
  const keys = await db.getAllKeys("backups");
  for (const k of keys.sort((a, b) => a - b).slice(0, -KEEP_BACKUPS)) await db.delete("backups", k);
};

export const latestBackup = async () => {
  const all = await (await getDB()).getAll("backups");
  return all.sort((a, b) => b.id - a.id)[0] ?? null;
};

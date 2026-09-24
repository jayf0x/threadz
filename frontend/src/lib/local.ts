import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Api } from "./api";
import { ApiError } from "./errors";
import { combineScore, matchScore } from "./search";
import type { Annotation, Message, MessageMeta, Snapshot, SyncResult, Thread, Unsynced, Version } from "./types";
import { byCreatedThenId, bySeq, mergeMessage, versionsOf } from "./versions";

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
type LAnnotation = Annotation & Dirty;
// A pending "delete this annotation" request, queued for the next sync's `annotationDeletes`.
// `baseVersion` is this device's last-known editedAt ?? createdAt for the row — the same idea as a
// thread's `base` hash, just scoped to one annotation. The row itself is removed from `annotations`
// immediately (a note needs no tombstone); this is only bookkeeping for the sync round-trip.
type AnnotationDelete = { id: string; threadId: string; baseVersion: number };
type Trashed = {
  id: string;
  thread: Thread;
  messages: Message[];
  annotations: Annotation[];
  deletedAt: number;
} & Dirty;
type Backup = { id: number; reason: string; json: string };

interface LocalDB extends DBSchema {
  threads: { key: string; value: LThread; indexes: { dirty: number } };
  messages: { key: string; value: LMessage; indexes: { byThread: string; dirty: number } };
  annotations: { key: string; value: LAnnotation; indexes: { byThread: string; byMessage: string; dirty: number } };
  annotationDeletes: { key: string; value: AnnotationDelete };
  trash: { key: string; value: Trashed; indexes: { dirty: number } };
  backups: { key: number; value: Backup };
  base: { key: string; value: { id: string; hash: string } };
}

let dbp: Promise<IDBPDatabase<LocalDB>> | null = null;

const getDB = () => {
  dbp ??= openDB<LocalDB>("threadz-local", 4, {
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
      if (old < 3) {
        const a = db.createObjectStore("annotations", { keyPath: "id" });
        a.createIndex("byThread", "threadId");
        a.createIndex("byMessage", "messageId");
        a.createIndex("dirty", "dirty");
      }
      if (old < 4) db.createObjectStore("annotationDeletes", { keyPath: "id" });
    },
  });
  return dbp;
};

// The note a thread is created with gets an id derived from the thread's, so main and the device
// agree on it: a create whose reply was lost and is retried here dedupes at sync instead of doubling the seed.
export const seedId = (threadId: string) => `seed-${threadId}`;

// Same discipline as `seedId`: a copied message's id is a pure function of (newThreadId,
// originalId), so a retried copy call re-derives the same ids instead of duplicating.
export const copyMessageId = (newThreadId: string, originalId: string) => `${newThreadId}:${originalId}`;

// Same determinism for a copied annotation, in its own namespace so it never collides with a
// copied message's id even though both derive from (newThreadId, originalId).
export const copyAnnotationId = (newThreadId: string, originalId: string) => `${newThreadId}:anno:${originalId}`;

const strip = <T extends Dirty>({ dirty, ...rest }: T): Omit<T, "dirty"> => rest;
const notFound = () => new ApiError(404, "thread not found");

// --- the Api, backed by IndexedDB --------------------------------------------

export const localApi: Api = {
  health: async () => ({ ok: true, model: "local" }),

  listThreads: async (q, sort = "updated") => {
    const db = await getDB();
    const threads = (await db.getAll("threads")).map(strip);
    const needle = q?.trim().toLowerCase();
    if (needle) {
      // v1 dropped generated description/tags from search (weak output, no UI for it) — titles and note
      // text only. Ranked, not just filtered — see lib/search.ts for why this isn't the backend's bm25.
      const contentScore = new Map<string, number>();
      for (const m of await db.getAll("messages")) {
        const s = matchScore(m.content, needle);
        if (s == null) continue;
        const best = contentScore.get(m.threadId);
        if (best == null || s > best) contentScore.set(m.threadId, s);
      }
      return threads
        .map((t) => ({ t, score: combineScore(matchScore(t.title, needle), contentScore.get(t.id) ?? null) }))
        .filter((r): r is { t: Thread; score: number } => r.score != null)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.t);
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
    const annotations = await db.getAllFromIndex("annotations", "byThread", id);
    return {
      thread: strip(thread),
      messages: messages.sort(bySeq).map(strip),
      annotations: annotations.sort(byCreatedThenId).map(strip),
    };
  },

  // Same shape as the backend's copyThread: one transaction, idempotent on `newThreadId`, new
  // message ids derived from it, original createdAt/edits/meta kept, description/tags/embedding
  // left null (a freshly created thread's defaults).
  copyThread: async (threadId, { newThreadId, uptoMessageId, appendNote }) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "messages", "annotations"], "readwrite");
    const already = await tx.objectStore("threads").get(newThreadId);
    if (already) {
      const messages = await tx.objectStore("messages").index("byThread").getAll(newThreadId);
      const annotations = await tx.objectStore("annotations").index("byThread").getAll(newThreadId);
      await tx.done;
      return {
        thread: strip(already),
        messages: messages.sort(bySeq).map(strip),
        annotations: annotations.sort(byCreatedThenId).map(strip),
      };
    }

    const source = await tx.objectStore("threads").get(threadId);
    if (!source) throw notFound();
    const all = (await tx.objectStore("messages").index("byThread").getAll(threadId)).sort(bySeq);
    const cut = all.findIndex((m) => m.id === uptoMessageId);
    if (cut < 0) throw new ApiError(404, "message not found");

    const ts = Date.now();
    const thread: LThread = {
      id: newThreadId,
      title: `Copy: ${source.title}`.slice(0, 200),
      createdAt: ts,
      updatedAt: ts,
      renamedAt: null,
      description: null,
      tags: [],
      hasEmbedding: false,
      dirty: 1,
    };
    await tx.objectStore("threads").put(thread);

    const toCopy = all.slice(0, cut + 1);
    for (const m of toCopy) {
      const newMessageId = copyMessageId(newThreadId, m.id);
      const copy: LMessage = { ...strip(m), id: newMessageId, threadId: newThreadId, dirty: 1 };
      await tx.objectStore("messages").put(copy);
      // Annotations on a copied message are copied too, with `messageId` remapped to the copy.
      for (const a of await tx.objectStore("annotations").index("byMessage").getAll(m.id)) {
        const copiedAnnotation: LAnnotation = {
          ...strip(a),
          id: copyAnnotationId(newThreadId, a.id),
          threadId: newThreadId,
          messageId: newMessageId,
          dirty: 1,
        };
        await tx.objectStore("annotations").put(copiedAnnotation);
      }
    }
    const note = appendNote?.content.trim();
    if (appendNote && note) {
      const message: LMessage = {
        id: appendNote.id,
        threadId: newThreadId,
        role: "user",
        content: note,
        createdAt: ts,
        seq: toCopy.length + 1,
        meta: null,
        dirty: 1,
      };
      await tx.objectStore("messages").put(message);
    }
    await tx.done;

    const messages = await db.getAllFromIndex("messages", "byThread", newThreadId);
    const annotations = await db.getAllFromIndex("annotations", "byThread", newThreadId);
    return {
      thread: strip(thread),
      messages: messages.sort(bySeq).map(strip),
      annotations: annotations.sort(byCreatedThenId).map(strip),
    };
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
    const tx = db.transaction(["threads", "messages", "annotations", "trash"], "readwrite");
    const thread = await tx.objectStore("threads").get(id);
    if (!thread) throw notFound();
    const rows = await tx.objectStore("messages").index("byThread").getAll(id);
    const annotations = await tx.objectStore("annotations").index("byThread").getAll(id);
    // Copy first, delete second, same transaction: either both happen or neither.
    await tx.objectStore("trash").put({
      id,
      thread: strip(thread),
      messages: rows.map(strip),
      annotations: annotations.map(strip),
      deletedAt: Date.now(),
      dirty: 1, // ponytail: always tell the backend; a 404 there is fine
    });
    for (const m of rows) await tx.objectStore("messages").delete(m.id);
    for (const a of annotations) await tx.objectStore("annotations").delete(a.id);
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
      meta: (meta as MessageMeta | null | undefined) ?? null,
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

  // Flags/unflags a whole message as a todo (the ⋯ menu's "Add/Remove Todos", the sidebar's
  // message-todo checkbox) — non-textual, merged into `meta` like the backend's editMessageMeta,
  // never a content edit. `done: null` clears the flag entirely (see removeMessageTodo below).
  // Own clock (`metaEditedAt`, not `editedAt`): mergeRemoteThread's `same()` check treats the two
  // independently, so a pending meta change never gets mistaken for (or clobbered by) a content merge.
  toggleMessageTodo: async (threadId, id, done) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "messages"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const old = await tx.objectStore("messages").get(id);
    if (!thread || !old || old.threadId !== threadId) throw notFound();
    const at = Date.now();
    const meta: MessageMeta = { ...(old.meta ?? {}), todo: { done } };
    const message: LMessage = { ...old, meta, metaEditedAt: at, dirty: 1 };
    await tx.objectStore("messages").put(message);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, at) });
    await tx.done;
    return { message: strip(message) };
  },

  removeMessageTodo: async (threadId, id) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "messages"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const old = await tx.objectStore("messages").get(id);
    if (!thread || !old || old.threadId !== threadId) throw notFound();
    const at = Date.now();
    const meta: MessageMeta = { ...(old.meta ?? {}) };
    delete meta.todo;
    const message: LMessage = { ...old, meta: Object.keys(meta).length ? meta : null, metaEditedAt: at, dirty: 1 };
    await tx.objectStore("messages").put(message);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, at) });
    await tx.done;
    return { message: strip(message) };
  },

  // No Claude on the device. Local mode is capture-only; the UI does not offer Ask.
  ask: async () => {
    throw new ApiError(503, "Claude isn't available offline — go live to ask.");
  },

  // Idempotent append, exactly like `appendMessage` (own row, not part of the message's dirty flag).
  appendAnnotation: async (threadId, messageId, { id, content, createdAt }) => {
    const text = content?.trim();
    if (!id || !text) throw new ApiError(400, "id and content are required");
    const db = await getDB();
    const tx = db.transaction(["threads", "messages", "annotations"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const message = await tx.objectStore("messages").get(messageId);
    if (!thread || !message || message.threadId !== threadId) throw notFound();
    const existing = await tx.objectStore("annotations").get(id);
    if (existing) return { annotation: strip(existing), inserted: false };
    const ts = createdAt ?? Date.now();
    const annotation: LAnnotation = { id, threadId, messageId, content: text, createdAt: ts, dirty: 1 };
    await tx.objectStore("annotations").put(annotation);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, ts) });
    await tx.done;
    return { annotation: strip(annotation), inserted: true };
  },

  editAnnotation: async (threadId, id, content) => {
    const text = content?.trim();
    if (!text) throw new ApiError(400, "content is required");
    const db = await getDB();
    const tx = db.transaction(["threads", "annotations"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const old = await tx.objectStore("annotations").get(id);
    if (!thread || !old || old.threadId !== threadId) throw notFound();
    if (text === old.content) return { annotation: strip(old) };
    const at = Date.now();
    const annotation: LAnnotation = {
      ...old,
      ...mergeMessage(old, { ...old, content: text, editedAt: at, edits: versionsOf(old) }),
      dirty: 1,
    };
    await tx.objectStore("annotations").put(annotation);
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, at) });
    await tx.done;
    return { annotation: strip(annotation) };
  },

  // No tombstone needed (unlike a thread): remove the row now, and queue a pending delete request
  // (its last-known version, as `baseVersion`) for the next sync to carry to main. If main since
  // changed the annotation, the sync refuses the delete and `mergeRemoteThread` brings it back —
  // same "content wins" shape as a thread delete, just at row granularity.
  deleteAnnotation: async (threadId, id) => {
    const db = await getDB();
    const tx = db.transaction(["threads", "annotations", "annotationDeletes"], "readwrite");
    const thread = await tx.objectStore("threads").get(threadId);
    const old = await tx.objectStore("annotations").get(id);
    if (!thread || !old || old.threadId !== threadId) throw notFound();
    await tx.objectStore("annotations").delete(id);
    await tx.objectStore("annotationDeletes").put({ id, threadId, baseVersion: old.editedAt ?? old.createdAt });
    const at = Date.now();
    await tx.objectStore("threads").put({ ...thread, updatedAt: Math.max(thread.updatedAt, at) });
    await tx.done;
    return { ok: true as const };
  },
};

// --- trash: query + restore surface for Recently Deleted / Undo ---------------

export type TrashedThread = { id: string; title: string; deletedAt: number };

// Backs the Recently Deleted view: everything `deleteThread`/`applyRemoteDelete` keeps in
// `trash` right now, without the full thread/messages/annotations payload a restore doesn't need
// until it's actually invoked. Newest deletion first.
export const listTrash = async (): Promise<TrashedThread[]> => {
  const rows = await (await getDB()).getAll("trash");
  return rows
    .map((t) => ({ id: t.id, title: t.thread.title, deletedAt: t.deletedAt }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
};

// The exact inverse of `deleteThread` above: puts a trashed thread's own rows back, marked dirty
// like any other local change so a future sync carries them out, and drops the trash row. Local
// mode's own read is this device copy, so that's the whole story there; a live-mode caller (see
// `handoff.ts`'s `restoreThread`) still has to push the result to main itself afterward — this
// function only ever touches the device copy.
export const restoreFromTrash = async (id: string): Promise<Thread> => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "annotations", "trash"], "readwrite");
  const trashed = await tx.objectStore("trash").get(id);
  if (!trashed) throw notFound();
  const thread: LThread = { ...trashed.thread, dirty: 1 };
  await tx.objectStore("threads").put(thread);
  for (const m of trashed.messages) await tx.objectStore("messages").put({ ...m, dirty: 1 });
  for (const a of trashed.annotations) await tx.objectStore("annotations").put({ ...a, dirty: 1 });
  await tx.objectStore("trash").delete(id);
  await tx.done;
  return strip(thread);
};

// --- sync bookkeeping ---------------------------------------------------------

export const countUnsynced = async (): Promise<Unsynced> => {
  const db = await getDB();
  const [threads, messages, annotations, trashed, annotationDeletes] = await Promise.all([
    db.countFromIndex("threads", "dirty", 1),
    db.countFromIndex("messages", "dirty", 1),
    db.countFromIndex("annotations", "dirty", 1),
    db.countFromIndex("trash", "dirty", 1),
    db.count("annotationDeletes"), // every row here is, by construction, a pending deletion
  ]);
  return { threads, messages, annotations, deletions: trashed + annotationDeletes };
};

export const unsyncedMessageIds = async (threadId: string) => {
  const rows = await (await getDB()).getAllFromIndex("messages", "byThread", threadId);
  return new Set(rows.filter((m) => m.dirty).map((m) => m.id));
};

export const unsyncedAnnotationIds = async (threadId: string) => {
  const rows = await (await getDB()).getAllFromIndex("annotations", "byThread", threadId);
  return new Set(rows.filter((a) => a.dirty).map((a) => a.id));
};

// Everything a sync must push, in the order it must be pushed.
export const unsyncedBatch = async () => {
  const db = await getDB();
  const messages = (await db.getAllFromIndex("messages", "dirty", 1)).sort(
    (a, b) => a.threadId.localeCompare(b.threadId) || bySeq(a, b),
  );
  const annotations = (await db.getAllFromIndex("annotations", "dirty", 1)).sort(
    (a, b) => a.threadId.localeCompare(b.threadId) || byCreatedThenId(a, b),
  );
  return {
    threads: await db.getAllFromIndex("threads", "dirty", 1),
    messages,
    annotations,
    annotationDeletes: await db.getAll("annotationDeletes"),
    trash: await db.getAllFromIndex("trash", "dirty", 1),
  };
};

export const localMessageIds = async (threadId: string) =>
  new Set((await (await getDB()).getAllFromIndex("messages", "byThread", threadId)).map((m) => m.id));

export const localAnnotationIds = async (threadId: string) =>
  new Set((await (await getDB()).getAllFromIndex("annotations", "byThread", threadId)).map((a) => a.id));

export const getBase = async () =>
  Object.fromEntries((await (await getDB()).getAll("base")).map((b) => [b.id, b.hash])) as Record<string, string>;

type Batch = Awaited<ReturnType<typeof unsyncedBatch>>;

// After main acknowledged a push: flip what was sent to clean, in ONE transaction. Each row is
// re-read and compared, on the fields that were sent, with the copy that was sent: one renamed or
// edited during the round-trip stays dirty for the next round instead of being marked clean by mistake.
// `missing`/`kept` rows stay dirty too.
export const commitPush = async (sent: Batch, r: SyncResult) => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "annotations", "annotationDeletes", "trash", "base"], "readwrite");
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
  for (const a of sent.annotations) {
    if (missing.has(a.threadId)) continue;
    const row = await tx.objectStore("annotations").get(a.id);
    if (row && sameMessage(row, a)) await tx.objectStore("annotations").put({ ...row, dirty: 0 });
  }
  for (const x of sent.trash) {
    const row = await tx.objectStore("trash").get(x.id);
    if (row && row.deletedAt === x.deletedAt) await tx.objectStore("trash").put({ ...row, dirty: 0 });
    if (r.deleted.includes(x.id)) await tx.objectStore("base").delete(x.id);
    // r.kept: main changed since our base. Leave base stale — the next pull sees the mismatch and resurrects the thread.
  }
  // r.deleted: main dropped the row (or already had, idempotent) — the pending request is done.
  // r.kept: main changed the annotation since our baseVersion — drop the pending request too (the
  // delete never applies), so the very next merge of this thread is free to bring the row back
  // instead of this stale record blocking it forever.
  for (const d of sent.annotationDeletes)
    if (r.deleted.includes(d.id) || r.kept.includes(d.id)) await tx.objectStore("annotationDeletes").delete(d.id);
  await tx.done;
};

// What /api/sync carries for a thread / a note; another field changing (updatedAt) is no reason to resend.
const sameThread = (a: Thread, b: Thread) => a.title === b.title && (a.renamedAt ?? null) === (b.renamedAt ?? null);
// `meta`/`metaEditedAt` are optional on the generic shape (an annotation has neither) so this one
// function still serves both call sites below.
const sameMessage = (
  a: {
    content: string;
    editedAt?: number | null;
    edits?: Version[];
    meta?: MessageMeta | null;
    metaEditedAt?: number | null;
  },
  b: typeof a,
) =>
  a.content === b.content &&
  (a.editedAt ?? null) === (b.editedAt ?? null) &&
  JSON.stringify(a.edits ?? []) === JSON.stringify(b.edits ?? []) &&
  JSON.stringify(a.meta ?? null) === JSON.stringify(b.meta ?? null) &&
  (a.metaEditedAt ?? null) === (b.metaEditedAt ?? null);

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

export const markAnnotationsDirty = async (annotationIds: string[]) => {
  const db = await getDB();
  const tx = db.transaction("annotations", "readwrite");
  for (const id of annotationIds) {
    const row = await tx.store.get(id);
    if (row) await tx.store.put({ ...row, dirty: 1 });
  }
  await tx.done;
};

// --- pulling main's changes into the device copy ------------------------------

// `meta`'s own last-write-wins merge, parallel to mergeMessage's content merge but on its own clock
// (`metaEditedAt`, not `editedAt`) — a meta-only change on one side must not be judged against the
// other side's content edit time. Newest `metaEditedAt` wins outright (no version history to keep:
// there's nothing to show an "edited" trail for on a boolean flag, unlike content).
const mergeMeta = (mine: Message, theirs: Message): Pick<Message, "meta" | "metaEditedAt"> =>
  (theirs.metaEditedAt ?? 0) >= (mine.metaEditedAt ?? 0)
    ? { meta: theirs.meta, metaEditedAt: theirs.metaEditedAt ?? null }
    : { meta: mine.meta, metaEditedAt: mine.metaEditedAt ?? null };

// Union main's version of a thread into ours. Never drops a local note; a thread we
// deleted but main changed comes back ("content wins"), along with our own notes and annotations.
export const mergeRemoteThread = async (
  thread: Thread,
  messages: Message[],
  annotations: Annotation[],
  hash: string | undefined,
) => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "annotations", "annotationDeletes", "trash", "base"], "readwrite");
  // Annotations this device is already mid-deleting: don't let main's (still current, pre-sync) copy
  // resurrect them before that delete gets a chance to reach main.
  const pendingDeletes = new Set(
    (await tx.objectStore("annotationDeletes").getAll()).filter((d) => d.threadId === thread.id).map((d) => d.id),
  );
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
    // Same note edited on both sides: newest text wins, the other stays in its history. `meta`
    // merges on its own clock (mergeMeta), independently — a pending meta-only change here must
    // survive a pull that brings in main's (older) meta, and vice versa.
    const merged = { ...mergeMessage(mine, m), ...mergeMeta(mine, m) };
    const same = (x: Message) =>
      x.content === merged.content &&
      (x.editedAt ?? null) === merged.editedAt &&
      (x.edits?.length ?? 0) === merged.edits?.length &&
      JSON.stringify(x.meta ?? null) === JSON.stringify(merged.meta ?? null) &&
      (x.metaEditedAt ?? null) === (merged.metaEditedAt ?? null);
    if (!same(m))
      await tx.objectStore("messages").put({ ...merged, dirty: 1 }); // main lacks something we hold
    else if (!same(mine)) await tx.objectStore("messages").put({ ...merged, dirty: 0 });
  }
  const mainIds = new Set(messages.map((m) => m.id));
  for (const m of trashed?.messages ?? []) {
    if (!mainIds.has(m.id) && !(await tx.objectStore("messages").get(m.id)))
      await tx.objectStore("messages").put({ ...m, dirty: 1 }); // our notes from before the delete
  }
  // Annotations union exactly like messages: their own rows, merged the same way.
  for (const a of annotations) {
    if (pendingDeletes.has(a.id)) continue; // we're deleting this locally; don't bring it back mid-flight
    const mine = await tx.objectStore("annotations").get(a.id);
    if (!mine) {
      await tx.objectStore("annotations").put({ ...a, dirty: 0 });
      added++;
      continue;
    }
    const merged = mergeMessage(mine, a);
    const same = (x: Annotation) =>
      x.content === merged.content &&
      (x.editedAt ?? null) === merged.editedAt &&
      (x.edits?.length ?? 0) === merged.edits?.length;
    if (!same(a))
      await tx.objectStore("annotations").put({ ...merged, dirty: 1 }); // main lacks something we hold
    else if (!same(mine)) await tx.objectStore("annotations").put({ ...merged, dirty: 0 });
  }
  const mainAnnotationIds = new Set(annotations.map((a) => a.id));
  for (const a of trashed?.annotations ?? []) {
    if (!mainAnnotationIds.has(a.id) && !(await tx.objectStore("annotations").get(a.id)))
      await tx.objectStore("annotations").put({ ...a, dirty: 1 }); // our annotations from before the delete
  }
  // main is the authoritative list for this thread right now: an annotation we hold that main no
  // longer has, that we didn't just add above and aren't mid-deleting ourselves, was deleted by
  // another device — follow (no tombstone needed). A dirty one is content-wins: keep it; the next
  // push re-creates it on main as an ordinary append (or folds into a race winner — see appendAnnotation).
  for (const mine of await tx.objectStore("annotations").index("byThread").getAll(thread.id)) {
    if (!mainAnnotationIds.has(mine.id) && !mine.dirty && !pendingDeletes.has(mine.id))
      await tx.objectStore("annotations").delete(mine.id);
  }
  if (hash) await tx.objectStore("base").put({ id: thread.id, hash });
  await tx.done;
  return { added, resurrected: !!trashed };
};

// Main deleted a thread we last saw. Clean copy → follow (kept in trash). Edited here, OR an
// unsynced annotation on an otherwise-clean message → keep it and re-send everything so main gets
// the whole thread back. An annotation is its own row, not part of a message's dirty flag, so it
// must be checked here too — otherwise a dirty annotation on a clean message is silently destroyed
// when main's delete is naively followed.
export const applyRemoteDelete = async (id: string): Promise<"removed" | "kept" | "none"> => {
  const db = await getDB();
  const tx = db.transaction(["threads", "messages", "annotations", "trash", "base"], "readwrite");
  await tx.objectStore("base").delete(id);
  const thread = await tx.objectStore("threads").get(id);
  if (!thread) {
    const t = await tx.objectStore("trash").get(id); // deleted on both sides
    if (t?.dirty) await tx.objectStore("trash").put({ ...t, dirty: 0 });
    await tx.done;
    return "none";
  }
  const rows = await tx.objectStore("messages").index("byThread").getAll(id);
  const annotations = await tx.objectStore("annotations").index("byThread").getAll(id);
  if (thread.dirty || rows.some((m) => m.dirty) || annotations.some((a) => a.dirty)) {
    await tx.objectStore("threads").put({ ...thread, dirty: 1 });
    for (const m of rows) await tx.objectStore("messages").put({ ...m, dirty: 1 });
    for (const a of annotations) await tx.objectStore("annotations").put({ ...a, dirty: 1 });
    await tx.done;
    return "kept";
  }
  await tx.objectStore("trash").put({
    id,
    thread: strip(thread),
    messages: rows.map(strip),
    annotations: annotations.map(strip),
    deletedAt: Date.now(),
    dirty: 0,
  });
  for (const m of rows) await tx.objectStore("messages").delete(m.id);
  for (const a of annotations) await tx.objectStore("annotations").delete(a.id);
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
  const tx = db.transaction(["threads", "messages", "annotations", "trash"], "readwrite");
  const added = { threads: 0, messages: 0, annotations: 0 };
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
  const placeAnnotation = async (a: Annotation) => {
    await tx.objectStore("annotations").put({ ...a, dirty: 1 });
    added.annotations++;
  };
  const ours: Message[] = []; // our own trashed notes of a thread the file brings back, placed after the file's
  const oursAnnotations: Annotation[] = [];
  for (const t of snap.threads) {
    if (await tx.objectStore("threads").get(t.id)) continue;
    await tx.objectStore("threads").put({ ...t, dirty: 1 });
    added.threads++;
    const trashed = await tx.objectStore("trash").get(t.id);
    if (!trashed) continue;
    await tx.objectStore("trash").delete(t.id);
    ours.push(...trashed.messages);
    oursAnnotations.push(...(trashed.annotations ?? []));
  }
  for (const m of [...snap.messages].sort(bySeq)) {
    if (!(await tx.objectStore("threads").get(m.threadId))) continue;
    if (await tx.objectStore("messages").get(m.id)) continue;
    await place(m);
  }
  for (const m of ours.sort(bySeq)) if (!(await tx.objectStore("messages").get(m.id))) await place(m);
  // Optional: an old backup file (made before annotations existed) has no `annotations` field.
  for (const a of snap.annotations ?? []) {
    if (!(await tx.objectStore("threads").get(a.threadId))) continue;
    if (await tx.objectStore("annotations").get(a.id)) continue;
    await placeAnnotation(a);
  }
  for (const a of oursAnnotations) if (!(await tx.objectStore("annotations").get(a.id))) await placeAnnotation(a);
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
    opt(m.metaEditedAt, num) &&
    (m.edits === undefined || versions(m.edits));
  const annotation = (a: unknown) =>
    rec(a) &&
    str(a.id) &&
    str(a.threadId) &&
    str(a.messageId) &&
    str(a.content) &&
    num(a.createdAt) &&
    opt(a.editedAt, num) &&
    (a.edits === undefined || versions(a.edits));
  if (!rec(raw) || raw.version !== 1 || !Array.isArray(raw.threads) || !Array.isArray(raw.messages)) return null;
  if (!raw.threads.every(thread) || !raw.messages.every(message)) return null;
  // Optional: an old backup file (made before annotations existed) has no `annotations` field.
  if (raw.annotations !== undefined && (!Array.isArray(raw.annotations) || !raw.annotations.every(annotation)))
    return null;
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
    annotations: (await db.getAll("annotations")).map(strip),
    trash: (await db.getAll("trash")).map(({ thread, messages, annotations, deletedAt }) => ({
      thread,
      messages,
      annotations,
      deletedAt,
    })),
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

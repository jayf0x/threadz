import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Role, SyncPayload } from "./schemas";

// Plain threads and messages. Databases made before `source` was dropped keep an inert
// `source TEXT NOT NULL DEFAULT 'pwa'` column: inserts that omit it get the default, so no migration.
// Exported so a test can re-run the real init (this + backfillSearchIndex below) against a
// throwaway db seeded like an older version of this schema, instead of re-implementing it.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  description TEXT,
  tags        TEXT,                 -- JSON string[]
  embedding   BLOB,                 -- Float32Array of the thread summary
  renamed_at  INTEGER               -- last rename; newest wins when a device syncs a title
);
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,     -- client-generated UUID == idempotency key
  thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,        -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  seq         INTEGER NOT NULL,     -- append order within the thread
  meta        TEXT,                 -- JSON object, e.g. {"voice":true} or {"todo":{"done":false}}
  edited_at   INTEGER,              -- when content was last edited (NULL = never)
  edits       TEXT,                 -- JSON [{content, at}] previous versions, oldest first
  meta_edited_at INTEGER            -- when meta was last patched (NULL = never); own clock from edited_at,
                                     -- so a meta-only change (no content touched) still moves threadHash
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,     -- client-generated UUID == idempotency key
  thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id  TEXT NOT NULL,        -- the message this annotation is attached to (never another annotation)
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,              -- when content was last edited (NULL = never)
  edits       TEXT                  -- JSON [{content, at}] previous versions, oldest first
);
CREATE INDEX IF NOT EXISTS idx_annotations_thread ON annotations(thread_id);
CREATE INDEX IF NOT EXISTS idx_annotations_message ON annotations(message_id);
-- One annotation per message. NOT created here: an existing database can already violate it (see
-- dedupeDuplicateAnnotations below), so the unique index is created separately, after that cleanup runs.

-- Search index: one row per thread, title and message text as separate FTS5 columns so bm25() can
-- weight title matches above body matches. 'trigram' (not the default unicode61) so a mid-word
-- substring like "izing" still matches "resizing" the way the old LIKE search did.
-- Kept in sync by triggers, not app code, so nothing that creates/edits a thread or message needs to
-- remember to update it (matches the "DB constraint over app code" instinct used for annotations above).
CREATE VIRTUAL TABLE IF NOT EXISTS thread_search USING fts5(
  thread_id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);
CREATE TRIGGER IF NOT EXISTS thread_search_ai AFTER INSERT ON threads BEGIN
  INSERT INTO thread_search (thread_id, title, body) VALUES (new.id, new.title, '');
END;
CREATE TRIGGER IF NOT EXISTS thread_search_au AFTER UPDATE OF title ON threads BEGIN
  UPDATE thread_search SET title = new.title WHERE thread_id = new.id;
END;
CREATE TRIGGER IF NOT EXISTS thread_search_ad AFTER DELETE ON threads BEGIN
  DELETE FROM thread_search WHERE thread_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS thread_search_msg_ai AFTER INSERT ON messages BEGIN
  UPDATE thread_search SET body = body || char(10) || new.content WHERE thread_id = new.thread_id;
END;
-- An edit or delete can't just patch the old text back out (it may appear more than once), so these
-- two recompute the whole body from what's left in messages -- cheap at personal-note scale.
CREATE TRIGGER IF NOT EXISTS thread_search_msg_au AFTER UPDATE OF content ON messages BEGIN
  UPDATE thread_search
     SET body = (SELECT coalesce(group_concat(content, char(10)), '')
                 FROM (SELECT content FROM messages WHERE thread_id = new.thread_id ORDER BY seq))
   WHERE thread_id = new.thread_id;
END;
CREATE TRIGGER IF NOT EXISTS thread_search_msg_ad AFTER DELETE ON messages BEGIN
  UPDATE thread_search
     SET body = (SELECT coalesce(group_concat(content, char(10)), '')
                 FROM (SELECT content FROM messages WHERE thread_id = old.thread_id ORDER BY seq))
   WHERE thread_id = old.thread_id;
END;
`;

export type ThreadRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  description: string | null;
  tags: string | null;
  embedding: Uint8Array | null;
  renamed_at: number | null;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
  created_at: number;
  seq: number;
  meta: string | null;
  edited_at: number | null;
  edits: string | null;
  meta_edited_at: number | null;
};

// Same fields as a message minus `role` (only the user writes annotations in v1), plus the thread
// and message it belongs to. No annotations of annotations: message_id always names a row in
// `messages`, never one in this table.
export type AnnotationRow = {
  id: string;
  thread_id: string;
  message_id: string;
  content: string;
  created_at: number;
  edited_at: number | null;
  edits: string | null;
};

export type Version = { content: string; at: number };

export const DB_PATH = process.env.THREADZ_DB || "threadz.sqlite";
export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

// One annotation per message, enforced by the DB (a unique index), not app code. A database from
// before this rule shipped can already have more than one row for the same message_id — creating a
// UNIQUE index against data that already violates it throws at startup, so dedupe first: for any
// message_id with more than one row, keep the most recently edited one (edited_at ?? created_at) and
// drop the rest. Their content is lost — an accepted, one-time consequence of moving to "one note per
// message". Runs every boot; it's a cheap no-op once there are no duplicates left.
// Takes a `Database` parameter (default: the module's own) so tests can exercise it against a
// throwaway db file seeded with a pre-existing violation, without disturbing the real one.
export const dedupeDuplicateAnnotations = (database: Database = db) => {
  const dupes = database
    .query<{ message_id: string }, []>("SELECT message_id FROM annotations GROUP BY message_id HAVING COUNT(*) > 1")
    .all();
  for (const { message_id } of dupes) {
    const rows = database
      .query<{ id: string; created_at: number; edited_at: number | null }, [string]>(
        "SELECT id, created_at, edited_at FROM annotations WHERE message_id = ?",
      )
      .all(message_id);
    const keep = rows.reduce((a, b) => ((b.edited_at ?? b.created_at) > (a.edited_at ?? a.created_at) ? b : a));
    for (const r of rows) if (r.id !== keep.id) database.query("DELETE FROM annotations WHERE id = ?").run(r.id);
  }
};
dedupeDuplicateAnnotations();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_annotations_one_per_message ON annotations(message_id)");

// A database from before `thread_search` existed has threads/messages but no rows in it yet: the
// triggers above only fire on new writes, so pre-existing rows need a one-time backfill. Guarded by
// a row-count check (cheap) and, within the insert itself, `NOT EXISTS` per thread, so this is safe
// (and a fast no-op) to run on every boot, backfilled or not — same shape as `addColumn` below.
// Takes a `Database` parameter (default: the module's own) so tests can exercise it against a
// throwaway db file seeded like an older version of this schema, without disturbing the real one.
export const backfillSearchIndex = (database: Database = db) => {
  const { n: indexed } = database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM thread_search").get()!;
  const { n: total } = database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM threads").get()!;
  if (indexed >= total) return;
  database.exec(`
    INSERT INTO thread_search (thread_id, title, body)
    SELECT t.id, t.title,
      COALESCE((SELECT group_concat(content, char(10)) FROM (SELECT content FROM messages WHERE thread_id = t.id ORDER BY seq)), '')
    FROM threads t
    WHERE NOT EXISTS (SELECT 1 FROM thread_search fs WHERE fs.thread_id = t.id)
  `);
};
backfillSearchIndex();

// Databases made before edit/rename existed: add the columns once.
const addColumn = (table: string, col: string, type: string) => {
  if (
    !db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === col)
  )
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
};
addColumn("threads", "renamed_at", "INTEGER");
addColumn("messages", "edited_at", "INTEGER");
addColumn("messages", "edits", "TEXT");
addColumn("messages", "meta_edited_at", "INTEGER");

export const now = () => Date.now();

// Client-supplied timestamps (offline captures) are honoured but never from the future.
export const clampTs = (t?: number) =>
  typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.min(t, now()) : now();

// --- threads ---

// A user's query, as a single literal FTS5 phrase: doubling `"` escapes it, and wrapping the whole
// thing in quotes stops FTS5 from reading `-`/`*`/`AND`/parens etc. as query syntax. For the
// trigram tokenizer this is also what makes it behave like a substring search: a quoted phrase
// requires its tokens (trigrams, here) adjacent and in order, which is exactly "contains this text".
const ftsPhrase = (q: string) => `"${q.replace(/"/g, '""')}"`;

export const listThreads = (q?: string, sort = "updated") => {
  const order =
    sort === "created" ? "created_at DESC" : sort === "title" ? "title COLLATE NOCASE ASC" : "updated_at DESC";
  const query = q?.trim();
  if (query) {
    // The trigram tokenizer has no trigrams to match below 3 characters (a MATCH just finds nothing,
    // it doesn't error) — fall back to the old substring LIKE scan so a 1-2 character search still
    // works, just without ranking. Rare at personal-note query lengths.
    if (query.length < 3) {
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      return db
        .query<ThreadRow, [string]>(
          `SELECT DISTINCT t.* FROM threads t
           LEFT JOIN messages m ON m.thread_id = t.id
           WHERE t.title LIKE ?1 ESCAPE '\\' OR m.content LIKE ?1 ESCAPE '\\'
           ORDER BY ${order}`,
        )
        .all(like);
    }
    // v1 dropped generated description/tags from search (weak output, no UI for it) — titles and note
    // text only. Ranked by bm25 (title weighted 10x over body); `sort` only orders the no-query case.
    return db
      .query<ThreadRow, [string]>(
        `SELECT t.* FROM threads t
         JOIN thread_search ON thread_search.thread_id = t.id
         WHERE thread_search MATCH ?1
         ORDER BY bm25(thread_search, 10.0, 1.0)`,
      )
      .all(ftsPhrase(query));
  }
  return db.query<ThreadRow, []>(`SELECT * FROM threads ORDER BY ${order}`).all();
};

export const getThread = (id: string) => db.query<ThreadRow, [string]>("SELECT * FROM threads WHERE id = ?").get(id);

export const allMessages = () =>
  db.query<MessageRow, []>("SELECT * FROM messages ORDER BY thread_id, seq, created_at").all();

export const getMessages = (threadId: string) =>
  db.query<MessageRow, [string]>("SELECT * FROM messages WHERE thread_id = ? ORDER BY seq, created_at").all(threadId);

export const getMessage = (id: string) => db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(id);

export const allAnnotations = () =>
  db.query<AnnotationRow, []>("SELECT * FROM annotations ORDER BY thread_id, created_at, id").all();

// Ordered by (createdAt, id), per the backlog's rendering order.
export const getAnnotations = (threadId: string) =>
  db
    .query<AnnotationRow, [string]>("SELECT * FROM annotations WHERE thread_id = ? ORDER BY created_at, id")
    .all(threadId);

export const getAnnotation = (id: string) =>
  db.query<AnnotationRow, [string]>("SELECT * FROM annotations WHERE id = ?").get(id);

export const getAnnotationsForMessage = (messageId: string) =>
  db
    .query<AnnotationRow, [string]>("SELECT * FROM annotations WHERE message_id = ? ORDER BY created_at, id")
    .all(messageId);

// `createdAt` lets a device that captured offline keep the original timestamp.
export const createThread = (id: string, title: string, createdAt?: number) => {
  const ts = clampTs(createdAt);
  db.query("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, title, ts, ts);
  return getThread(id)!;
};

// Idempotent append: client UUID is the primary key, conflict = already have it.
// Returns { message, inserted } so the caller knows whether to fire metadata.
export const appendMessage = (msg: {
  id: string;
  threadId: string;
  role: Role;
  content: string;
  meta?: unknown;
  createdAt?: number;
}) => {
  const existing = db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(msg.id);
  if (existing) return { message: existing, inserted: false };

  const ts = clampTs(msg.createdAt);
  const seqRow = db
    .query<{ n: number }, [string]>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE thread_id = ?")
    .get(msg.threadId)!;
  db.query(
    "INSERT INTO messages (id, thread_id, role, content, created_at, seq, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(msg.id, msg.threadId, msg.role, msg.content, ts, seqRow.n, msg.meta ? JSON.stringify(msg.meta) : null);
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(ts, msg.threadId);
  const message = db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(msg.id)!;
  return { message, inserted: true };
};

// Deterministic per-copy id: same (newThreadId, originalId) always derives the same message id, so
// a retried copy call (same client-minted newThreadId) re-derives identical ids instead of duplicating.
export const copyMessageId = (newThreadId: string, originalId: string) => `${newThreadId}:${originalId}`;

// Same determinism for a copied annotation: a distinct namespace from `copyMessageId` so the two
// never collide even though both derive from (newThreadId, originalId).
export const copyAnnotationId = (newThreadId: string, originalId: string) => `${newThreadId}:anno:${originalId}`;

// Copies `sourceId` from its first message up to and including `uptoId` into a brand-new thread
// `newId` (new message ids, original `createdAt`/edits/meta kept, description/tags/embedding stay
// null). One transaction: the thread, every copied message and the optional appended note land
// together or not at all. Idempotent on `newId` — a retry with the same id returns what's already
// there instead of duplicating. Returns null if the source thread or `uptoId` doesn't exist.
export const copyThread = db.transaction(
  (
    newId: string,
    sourceId: string,
    uptoId: string,
    appendNote?: { id: string; content: string; createdAt?: number },
  ): { thread: ThreadRow; messages: MessageRow[]; annotations: AnnotationRow[] } | null => {
    const already = getThread(newId);
    if (already) return { thread: already, messages: getMessages(newId), annotations: getAnnotations(newId) };

    const source = getThread(sourceId);
    if (!source) return null;
    const all = getMessages(sourceId);
    const cut = all.findIndex((m) => m.id === uptoId);
    if (cut < 0) return null;

    const ts = now();
    const title = `Copy: ${source.title}`.slice(0, 200);
    db.query("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(newId, title, ts, ts);

    const toCopy = all.slice(0, cut + 1);
    for (const m of toCopy) {
      db.query(
        "INSERT INTO messages (id, thread_id, role, content, created_at, seq, meta, edited_at, edits, meta_edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        copyMessageId(newId, m.id),
        newId,
        m.role,
        m.content,
        m.created_at,
        m.seq,
        m.meta,
        m.edited_at,
        m.edits,
        m.meta_edited_at,
      );
      // Annotations on a copied message are copied too, with `message_id` remapped to the copy.
      for (const a of getAnnotationsForMessage(m.id)) {
        db.query(
          "INSERT INTO annotations (id, thread_id, message_id, content, created_at, edited_at, edits) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          copyAnnotationId(newId, a.id),
          newId,
          copyMessageId(newId, m.id),
          a.content,
          a.created_at,
          a.edited_at,
          a.edits,
        );
      }
    }

    const note = appendNote?.content.trim();
    if (appendNote && note) {
      db.query("INSERT INTO messages (id, thread_id, role, content, created_at, seq) VALUES (?, ?, ?, ?, ?, ?)").run(
        appendNote.id,
        newId,
        "user",
        note,
        clampTs(appendNote.createdAt),
        toCopy.length + 1,
      );
    }
    db.query("UPDATE threads SET updated_at = ? WHERE id = ?").run(now(), newId);

    return { thread: getThread(newId)!, messages: getMessages(newId), annotations: getAnnotations(newId) };
  },
);

export const setMetadata = (threadId: string, description: string, tags: string[], embedding: Float32Array) => {
  db.query("UPDATE threads SET description = ?, tags = ?, embedding = ? WHERE id = ?").run(
    description,
    JSON.stringify(tags),
    new Uint8Array(embedding.buffer),
    threadId,
  );
};

export const deleteThread = (id: string) => {
  db.query("DELETE FROM messages WHERE thread_id = ?").run(id);
  db.query("DELETE FROM threads WHERE id = ?").run(id);
};

// Newest rename wins. A device syncing an older title never clobbers a newer one on main.
export const renameThread = (id: string, title: string, renamedAt?: number) => {
  const t = getThread(id);
  const at = clampTs(renamedAt);
  const clean = title.trim().slice(0, 200);
  if (!t || !clean || at <= (t.renamed_at ?? 0)) return t;
  db.query("UPDATE threads SET title = ?, renamed_at = ?, updated_at = MAX(updated_at, ?) WHERE id = ?").run(
    clean,
    at,
    at,
    id,
  );
  return getThread(id)!;
};

// Every version of a message (previous ones + the current one) merged with another set,
// newest wins, the rest kept as history. Symmetric, so two devices converge whatever the
// order they sync in. `at` is the identity of a version.
export const mergeVersions = (a: Version[], b: Version[]) => {
  const byAt = new Map<number, Version>();
  for (const v of [...a, ...b]) byAt.set(v.at, v);
  const all = [...byAt.values()].sort((x, y) => x.at - y.at);
  return { current: all.at(-1)!, edits: all.slice(0, -1) };
};

// A row with the "content + edit history" shape shared by messages and annotations.
type Versioned = { content: string; created_at: number; edited_at: number | null; edits: string | null };

const versionsOf = (m: Versioned): Version[] => [
  ...(m.edits ? (JSON.parse(m.edits) as Version[]) : []),
  { content: m.content, at: m.edited_at ?? m.created_at },
];

// Edit a message (`incoming` = its new version, plus history when it comes from a device).
export const editMessage = (id: string, incoming: Version[]) => {
  const m = db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(id);
  if (!m) return null;
  if (incoming.length === 1 && incoming[0]?.content === m.content) return m; // nothing changed
  const { current, edits } = mergeVersions(versionsOf(m), incoming);
  const at = m.edited_at ?? m.created_at;
  if (current.at === at && current.content === m.content && edits.length === versionsOf(m).length - 1) return m;
  db.query("UPDATE messages SET content = ?, edited_at = ?, edits = ? WHERE id = ?").run(
    current.content,
    current.at,
    edits.length ? JSON.stringify(edits) : null,
    id,
  );
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(current.at, m.thread_id);
  return db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(id)!;
};

// Patch a message's `meta` (the "Add to Todos" flag and anything else that lands there later) —
// merged into the existing object, never replacing it wholesale: a key set to `null` in `patch` is
// removed, any other key is set/overwritten, and keys `patch` doesn't mention are left alone. Own
// clock (`meta_edited_at`), not `edited_at` — a meta-only change must not read as a content edit (no
// history entry, no "edited" label) but still has to move threadHash so a pull picks it up. Same
// last-write-wins shape as content's `edited_at`, just without a version history — nothing here needs
// an undo trail for a boolean flag.
export const editMessageMeta = (id: string, patch: Record<string, unknown>, at: number) => {
  const m = getMessage(id);
  if (!m) return null;
  if (at < (m.meta_edited_at ?? 0)) return m; // an older write loses to a newer one already applied
  const current: Record<string, unknown> = m.meta ? JSON.parse(m.meta) : {};
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const metaOut = Object.keys(merged).length ? JSON.stringify(merged) : null;
  db.query("UPDATE messages SET meta = ?, meta_edited_at = ? WHERE id = ?").run(metaOut, at, id);
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(at, m.thread_id);
  return db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(id)!;
};

// Sync's counterpart to editMessageMeta above — used by applySync, NOT the live PATCH route.
// A device syncing up sends its whole current `meta` value for a row (same idea as `content`: the
// entire string is replaced wholesale on a newer edit, not merged character-by-character), so this
// REPLACES `meta` outright when `at` is newer, exactly like editMessage does for content — it does
// NOT merge key-by-key like editMessageMeta. Merging here would be wrong: a device's `meta` can be
// stale on keys it never touched (e.g. dirty only because of a content edit, still carrying whatever
// meta it last pulled), and merging that stale snapshot over a genuinely newer value some other
// device wrote directly on main would silently resurrect the stale one. The `at < meta_edited_at`
// guard is what makes replacing safe: a stale device's older meta is a no-op here.
export const setMessageMeta = (id: string, meta: Record<string, unknown> | null, at: number) => {
  const m = getMessage(id);
  if (!m) return null;
  if (at < (m.meta_edited_at ?? 0)) return m;
  const metaOut = meta && Object.keys(meta).length ? JSON.stringify(meta) : null;
  db.query("UPDATE messages SET meta = ?, meta_edited_at = ? WHERE id = ?").run(metaOut, at, id);
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(at, m.thread_id);
  return db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(id)!;
};

// --- annotations ---

const isUniqueConstraintError = (err: unknown) => err instanceof Error && /UNIQUE constraint failed/i.test(err.message);

// Idempotent create, exactly like `appendMessage`: client UUID is the primary key.
export const appendAnnotation = (a: {
  id: string;
  threadId: string;
  messageId: string;
  content: string;
  createdAt?: number;
}) => {
  const existing = getAnnotation(a.id);
  if (existing) return { annotation: existing, inserted: false };
  const ts = clampTs(a.createdAt);
  try {
    db.query("INSERT INTO annotations (id, thread_id, message_id, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
      a.id,
      a.threadId,
      a.messageId,
      a.content,
      ts,
    );
  } catch (err) {
    // idx_annotations_one_per_message refused a second row for this message_id. This only realistically
    // happens when two offline devices each annotate the same message before either has synced — rare at
    // personal scale, not worth a real multi-writer merge. Fold the incoming content in as a new edit onto
    // the row that got there first; the losing device's local annotation id is simply orphaned there until
    // its next pull reconciles it away (see local.ts).
    if (!isUniqueConstraintError(err)) throw err;
    const winner = getAnnotationsForMessage(a.messageId)[0];
    if (!winner) throw err; // shouldn't happen, but never swallow a real error
    return { annotation: editAnnotation(winner.id, [{ content: a.content, at: ts }])!, inserted: false };
  }
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(ts, a.threadId);
  return { annotation: getAnnotation(a.id)!, inserted: true };
};

// Edit an annotation, same history-keeping as `editMessage` (reuses `mergeVersions`/`versionsOf`).
export const editAnnotation = (id: string, incoming: Version[]) => {
  const a = getAnnotation(id);
  if (!a) return null;
  if (incoming.length === 1 && incoming[0]?.content === a.content) return a; // nothing changed
  const { current, edits } = mergeVersions(versionsOf(a), incoming);
  const at = a.edited_at ?? a.created_at;
  if (current.at === at && current.content === a.content && edits.length === versionsOf(a).length - 1) return a;
  db.query("UPDATE annotations SET content = ?, edited_at = ?, edits = ? WHERE id = ?").run(
    current.content,
    current.at,
    edits.length ? JSON.stringify(edits) : null,
    id,
  );
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(current.at, a.thread_id);
  return getAnnotation(id)!;
};

// Hard delete. Unlike a message, an annotation is a small note with no append-only requirement — the
// whole point of "one note per message" is that it's genuinely removable, so no tombstone/edit-history
// is kept for the deleted row itself.
export const deleteAnnotation = (id: string) => {
  const a = getAnnotation(id);
  if (!a) return null;
  db.query("DELETE FROM annotations WHERE id = ?").run(id);
  db.query("UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(now(), a.thread_id);
  return a;
};

export const threadEmbeddings = () =>
  db
    .query<{ id: string; title: string; embedding: Uint8Array }, []>(
      "SELECT id, title, embedding FROM threads WHERE embedding IS NOT NULL",
    )
    .all()
    // copy into a fresh aligned buffer before viewing as Float32
    .map((r) => ({ id: r.id, title: r.title, vec: new Float32Array(new Uint8Array(r.embedding).buffer) }));

// Serialize a row for JSON responses (drop the raw blob, parse tags).
export const threadJson = (t: ThreadRow) => ({
  id: t.id,
  title: t.title,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  renamedAt: t.renamed_at,
  description: t.description,
  tags: t.tags ? (JSON.parse(t.tags) as string[]) : [],
  hasEmbedding: !!t.embedding,
});

export const messageJson = (m: MessageRow) => ({
  id: m.id,
  threadId: m.thread_id,
  role: m.role,
  content: m.content,
  createdAt: m.created_at,
  seq: m.seq,
  meta: m.meta ? JSON.parse(m.meta) : null,
  editedAt: m.edited_at,
  edits: m.edits ? (JSON.parse(m.edits) as Version[]) : [],
  metaEditedAt: m.meta_edited_at,
});

export const annotationJson = (a: AnnotationRow) => ({
  id: a.id,
  threadId: a.thread_id,
  messageId: a.message_id,
  content: a.content,
  createdAt: a.created_at,
  editedAt: a.edited_at,
  edits: a.edits ? (JSON.parse(a.edits) as Version[]) : [],
});

// --- change detection + sync ---------------------------------------------------

// What a device compares to know whether main moved. Title + message ids + edit times only:
// description/tags are generated asynchronously after every append and would make
// main look like it "keeps changing" right after a sync.
//
// Annotations are folded in the same way (id + edit time), but ONLY when the thread actually has
// at least one: an unconditional extra segment would change every existing thread's hash the moment
// this table exists, and every device's stored `base` would mismatch on upgrade — spurious "main
// changed" and refused pending deletes. A thread with zero annotations hashes exactly as before.
export const threadHash = (t: ThreadRow) => {
  const ids = db
    .query<{ id: string; edited_at: number | null; meta_edited_at: number | null }, [string]>(
      "SELECT id, edited_at, meta_edited_at FROM messages WHERE thread_id = ? ORDER BY id",
    )
    .all(t.id)
    .map((r) => {
      // A message with only `meta` touched (never a content edit) must still move the hash, so a pull
      // notices — same suffix shape as before (`id@at`) when either clock has ever moved, bare id
      // when neither has (byte-for-byte the pre-meta_edited_at formula for every message untouched by this).
      const at = Math.max(r.edited_at ?? 0, r.meta_edited_at ?? 0);
      return at ? `${r.id}@${at}` : r.id;
    });
  const annotations = db
    .query<{ id: string; edited_at: number | null }, [string]>(
      "SELECT id, edited_at FROM annotations WHERE thread_id = ? ORDER BY id",
    )
    .all(t.id);
  const annoSuffix = annotations.length
    ? `\n${annotations.map((r) => (r.edited_at ? `${r.id}@${r.edited_at}` : r.id)).join(",")}`
    : "";
  return new Bun.CryptoHasher("sha1").update(`${t.id}\n${t.title}\n${ids.join(",")}${annoSuffix}`).digest("hex");
};

export const heads = () => {
  const threads: Record<string, string> = {};
  for (const t of listThreads()) threads[t.id] = threadHash(t);
  const head = new Bun.CryptoHasher("sha1")
    .update(
      Object.entries(threads)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([id, h]) => `${id}:${h}`)
        .join("\n"),
    )
    .digest("hex");
  return { head, threads };
};

const KEEP_BACKUPS = Number(process.env.THREADZ_KEEP_BACKUPS || 20);

// A consistent copy of the whole database, taken before a device's changes are applied.
// Reverting main = stop the backend and copy one of these over threadz.sqlite.
// Text only: images are files in their own directory (backend/images.ts) and are never copied here.
export const backupDb = () => {
  const dir = process.env.THREADZ_BACKUPS || join(dirname(resolve(DB_PATH)), "backups");
  mkdirSync(dir, { recursive: true });
  // suffix: two syncs in one millisecond must not collide (VACUUM INTO refuses to overwrite)
  const file = join(
    dir,
    `threadz-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 6)}.sqlite`,
  );
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir)
    .filter((f) => f.startsWith("threadz-") && f.endsWith(".sqlite"))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) unlinkSync(join(dir, f));
  return file;
};

// Union-merge a device's offline work into main, all-or-nothing. Appends and creates are
// idempotent; a delete never destroys edits the device hasn't seen ("content wins").
export const applySync = db.transaction((p: SyncPayload) => {
  const touched = new Set<string>();
  const missing = new Set<string>();
  const kept: string[] = [];
  const deleted: string[] = [];
  let created = 0;
  let appended = 0;

  for (const t of p.threads) {
    if (!getThread(t.id)) {
      createThread(t.id, (t.title || "Untitled thread").slice(0, 200), t.createdAt);
      created++;
    }
    if (t.renamedAt) renameThread(t.id, t.title, t.renamedAt);
    touched.add(t.id);
  }
  for (const m of p.messages) {
    if (!getThread(m.threadId)) {
      missing.add(m.threadId); // deleted on main since the device last looked — it will re-pull and retry
      continue;
    }
    // A new message arrives as its first version; the edits are then merged on top.
    const r = appendMessage({ ...m, content: m.edits?.[0]?.content ?? m.content, role: m.role || "user" });
    if (r.inserted) appended++;
    if (m.editedAt) editMessage(m.id, [...(m.edits ?? []), { content: m.content, at: m.editedAt }]);
    // `meta` at creation is covered by appendMessage above; a LATER meta-only change (the message
    // already existed on main) only lands through this — appendMessage no-ops for an id it already
    // has, so without this a device's meta change would silently never reach main. `setMessageMeta`
    // (not editMessageMeta — that one merges key-by-key for the live PATCH route, this replaces the
    // whole value like `editedAt` does for content, see its own comment) applied the same way the
    // `editedAt` line above already is.
    if (m.metaEditedAt) setMessageMeta(m.id, (m.meta as Record<string, unknown> | null) ?? null, m.metaEditedAt);
    touched.add(m.threadId);
  }
  for (const a of p.annotations ?? []) {
    if (!getThread(a.threadId)) {
      missing.add(a.threadId); // thread deleted on main since the device last looked — re-pull and retry
      continue;
    }
    // A new annotation arrives as its first version; the edits are then merged on top (same as messages).
    const r = appendAnnotation({ ...a, content: a.edits?.[0]?.content ?? a.content });
    if (r.inserted) appended++;
    if (a.editedAt) editAnnotation(a.id, [...(a.edits ?? []), { content: a.content, at: a.editedAt }]);
    touched.add(a.threadId);
  }
  // Annotation deletes, at row granularity: mirrors the thread-delete loop above exactly, just scoped
  // to one annotation instead of a whole thread. `baseVersion` is the device's last-known edited_at ??
  // created_at for that row — "content wins", so a delete only lands if nobody touched it since.
  for (const d of p.annotationDeletes ?? []) {
    const a = getAnnotation(d.id);
    if (!a) {
      deleted.push(d.id); // already gone — idempotent, same as a replayed thread delete
      continue;
    }
    touched.add(a.thread_id);
    if ((a.edited_at ?? a.created_at) === d.baseVersion) {
      deleteAnnotation(d.id);
      deleted.push(d.id);
    } else kept.push(d.id); // edited since the device last saw it — the note survives
  }
  for (const d of p.deletes) {
    const t = getThread(d.id);
    if (!t) deleted.push(d.id);
    else if (threadHash(t) === d.baseHash) {
      deleteThread(d.id);
      deleted.push(d.id);
    } else kept.push(d.id);
  }

  const hashes: Record<string, string> = {};
  for (const id of touched) {
    const t = getThread(id);
    if (t) hashes[id] = threadHash(t);
  }
  return { created, appended, deleted, kept, missing: [...missing], hashes, touched: [...touched] };
});

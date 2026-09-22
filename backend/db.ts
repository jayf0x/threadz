import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Role, SyncPayload } from "./schemas";

// Plain threads and messages. Databases made before `source` was dropped keep an inert
// `source TEXT NOT NULL DEFAULT 'pwa'` column: inserts that omit it get the default, so no migration.
const SCHEMA = `
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
  meta        TEXT,                 -- JSON object, e.g. {"voice":true}
  edited_at   INTEGER,              -- when content was last edited (NULL = never)
  edits       TEXT                  -- JSON [{content, at}] previous versions, oldest first
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
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
};

export type Version = { content: string; at: number };

export const DB_PATH = process.env.THREADZ_DB || "threadz.sqlite";
export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

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

export const now = () => Date.now();

// Client-supplied timestamps (offline captures) are honoured but never from the future.
export const clampTs = (t?: number) =>
  typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.min(t, now()) : now();

// --- threads ---

export const listThreads = (q?: string, sort = "updated") => {
  const order =
    sort === "created" ? "created_at DESC" : sort === "title" ? "title COLLATE NOCASE ASC" : "updated_at DESC";
  if (q?.trim()) {
    // `%` and `_` in the query are literal characters, not wildcards.
    const like = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    // v1 dropped generated description/tags from search (weak output, no UI for it) — titles and note text only.
    return db
      .query<ThreadRow, [string]>(
        `SELECT DISTINCT t.* FROM threads t
         LEFT JOIN messages m ON m.thread_id = t.id
         WHERE t.title LIKE ?1 ESCAPE '\\' OR m.content LIKE ?1 ESCAPE '\\'
         ORDER BY ${order}`,
      )
      .all(like);
  }
  return db.query<ThreadRow, []>(`SELECT * FROM threads ORDER BY ${order}`).all();
};

export const getThread = (id: string) => db.query<ThreadRow, [string]>("SELECT * FROM threads WHERE id = ?").get(id);

export const allMessages = () =>
  db.query<MessageRow, []>("SELECT * FROM messages ORDER BY thread_id, seq, created_at").all();

export const getMessages = (threadId: string) =>
  db.query<MessageRow, [string]>("SELECT * FROM messages WHERE thread_id = ? ORDER BY seq, created_at").all(threadId);

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

const versionsOf = (m: MessageRow): Version[] => [
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
});

// --- change detection + sync ---------------------------------------------------

// What a device compares to know whether main moved. Title + message ids + edit times only:
// description/tags are generated asynchronously after every append and would make
// main look like it "keeps changing" right after a sync.
export const threadHash = (t: ThreadRow) => {
  const ids = db
    .query<{ id: string; edited_at: number | null }, [string]>(
      "SELECT id, edited_at FROM messages WHERE thread_id = ? ORDER BY id",
    )
    .all(t.id)
    .map((r) => (r.edited_at ? `${r.id}@${r.edited_at}` : r.id));
  return new Bun.CryptoHasher("sha1").update(`${t.id}\n${t.title}\n${ids.join(",")}`).digest("hex");
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
    touched.add(m.threadId);
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

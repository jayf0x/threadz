import { Database } from "bun:sqlite";

// Source-agnostic store: `source` is metadata on every row, never structure.
// A future Obsidian / ~/.claude importer is just another writer with a different `source`.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'pwa',
  description TEXT,
  tags        TEXT,                 -- JSON string[]
  embedding   BLOB                  -- Float32Array of the thread summary
);
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,     -- client-generated UUID == idempotency key
  thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,        -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  seq         INTEGER NOT NULL,     -- append order within the thread
  source      TEXT NOT NULL DEFAULT 'pwa',
  meta        TEXT                  -- JSON object, e.g. {"voice":true}
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
`;

export type ThreadRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  source: string;
  description: string | null;
  tags: string | null;
  embedding: Uint8Array | null;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: number;
  seq: number;
  source: string;
  meta: string | null;
};

export const db = new Database(process.env.THREADZ_DB || "threadz.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

export const now = () => Date.now();

// --- threads ---

export const listThreads = (q?: string, sort = "updated") => {
  const order =
    sort === "created" ? "created_at DESC" : sort === "title" ? "title COLLATE NOCASE ASC" : "updated_at DESC";
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    return db
      .query<ThreadRow, [string, string, string]>(
        `SELECT DISTINCT t.* FROM threads t
         LEFT JOIN messages m ON m.thread_id = t.id
         WHERE t.title LIKE ?1 OR t.description LIKE ?1 OR t.tags LIKE ?1 OR m.content LIKE ?1
         ORDER BY ${order}`,
      )
      .all(like, like, like);
  }
  return db.query<ThreadRow, []>(`SELECT * FROM threads ORDER BY ${order}`).all();
};

export const getThread = (id: string) => db.query<ThreadRow, [string]>("SELECT * FROM threads WHERE id = ?").get(id);

export const getMessages = (threadId: string) =>
  db.query<MessageRow, [string]>("SELECT * FROM messages WHERE thread_id = ? ORDER BY seq").all(threadId);

export const createThread = (id: string, title: string, source = "pwa") => {
  const ts = now();
  db.query("INSERT INTO threads (id, title, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?)").run(
    id,
    title,
    ts,
    ts,
    source,
  );
  return getThread(id)!;
};

// Idempotent append: client UUID is the primary key, conflict = already have it.
// Returns { message, inserted } so the caller knows whether to fire metadata.
export const appendMessage = (msg: {
  id: string;
  threadId: string;
  role: string;
  content: string;
  source?: string;
  meta?: unknown;
}) => {
  const existing = db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?").get(msg.id);
  if (existing) return { message: existing, inserted: false };

  const ts = now();
  const seqRow = db
    .query<{ n: number }, [string]>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE thread_id = ?")
    .get(msg.threadId)!;
  db.query(
    "INSERT INTO messages (id, thread_id, role, content, created_at, seq, source, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    msg.id,
    msg.threadId,
    msg.role,
    msg.content,
    ts,
    seqRow.n,
    msg.source || "pwa",
    msg.meta ? JSON.stringify(msg.meta) : null,
  );
  db.query("UPDATE threads SET updated_at = ? WHERE id = ?").run(ts, msg.threadId);
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
  source: t.source,
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
  source: m.source,
  meta: m.meta ? JSON.parse(m.meta) : null,
});

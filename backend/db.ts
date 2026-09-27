import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Driver, initSchema } from "@threadz/core";
import { bunDriver } from "@threadz/core/bun";

// v2 (docs/direction.md "Data model" + "Sync"): main is core/'s shared schema over bun:sqlite --
// no v1 threads/messages/annotations tables, no per-thread hashes/`base`. `core/schema.ts` and
// `core/merge.ts` own the model and the sync rules; this file just opens the real file and wires
// core's async `Driver` interface onto bun:sqlite's synchronous one (bunDriver does the wrapping).

export const DB_PATH = process.env.THREADZ_DB || "threadz.sqlite";
export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const driver: Driver = bunDriver(db);

// Memoized rather than a top-level `await`: under `bun test --isolate`, a top-level await here was
// observed racing server.ts's route setup ("Cannot access 'backupDb' before initialization"),
// so every caller that touches the driver explicitly awaits this instead of relying on ESM
// instantiation order. Kicked off immediately (not lazily on first call) so a normal boot still
// initializes right away.
let schemaReady: Promise<void> | undefined;
export const ensureSchema = (): Promise<void> => (schemaReady ??= initSchema(driver));
void ensureSchema();

export const now = () => Date.now();

// Client-supplied timestamps (offline captures) are honoured but never from the future (docs/
// direction.md "B6": clamp-only clock trust -- one phone, one main, no per-row HLC).
export const clampTs = (t?: number) =>
  typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.min(t, now()) : now();

// The rev main is currently at (`core_state`'s counter, stamped by `stampRevs`). 0 before anything
// has ever been stamped, so a fresh device's `since=0` pull sees everything.
export const currentRev = async (): Promise<number> => {
  const [row] = await driver.all<{ value: number }>("SELECT value FROM core_state WHERE key = 'rev'");
  return row?.value ?? 0;
};

// A thread row for existence checks (Ask needs to 404 on an unknown thread before calling the
// model). Not deleted, i.e. its entity has no `deleted_at`.
export const getThread = async (id: string) => {
  const [t] = await driver.all<{ id: string; title: string; updated_at: number; rev: number | null }>(
    "SELECT t.* FROM threads t JOIN entities e ON e.id = t.id WHERE t.id = ? AND e.deleted_at IS NULL",
    [id],
  );
  return t ?? null;
};

// Write a note placed as a new message at the end of a thread: entity(note) + note_versions(one
// row) + entity(message) + messages(placement) -- the same four-row shape core/core.test.ts's own
// test helper builds by hand. Used by Ask to write the question and the answer (docs/direction.md
// "B10"): push -> ask -> main writes question+answer as notes -> pull (the pull is the client's
// job; this only has to leave rows a `changesSince` will pick up).
export const appendNoteMessage = async (
  d: Driver,
  threadId: string,
  content: string,
  author: "user" | "assistant",
  at: number,
) => {
  const noteId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await d.run(
    "INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, 'note', ?, ?, NULL, NULL)",
    [noteId, at, at],
  );
  await d.run(
    "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
    [versionId, noteId, content, author, at],
  );
  await d.run(
    "INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, 'message', ?, ?, NULL, NULL)",
    [messageId, at, at],
  );
  await d.run(
    "INSERT INTO messages (id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, NULL, NULL)",
    [messageId, threadId, noteId, at],
  );
  return { noteId, versionId, messageId };
};

// --- backups -----------------------------------------------------------------------------------
// A consistent copy of the whole database, taken before a device's push is applied. Reverting main
// = stop the backend and copy one of these over threadz.sqlite. Text only: images are files in
// their own directory (backend/images.ts) and are never copied here.
const KEEP_BACKUPS = Number(process.env.THREADZ_KEEP_BACKUPS || 20);

// TODO (docs/direction.md "B8", flagged not implemented): retention is still by count, not time.
// Under "keep live" (a push roughly every 15s per Round 5's B7) that cycles through all
// `KEEP_BACKUPS` copies in a few minutes. direction.md's answer is an hourly-for-a-day /
// daily-for-a-month / weekly Time-Machine-style schedule; that scheduling logic isn't written yet
// -- left as a backlog item (see backlog.md) rather than guessed at here.
export const backupDb = () => {
  const dir = process.env.THREADZ_BACKUPS || join(dirname(resolve(DB_PATH)), "backups");
  mkdirSync(dir, { recursive: true });
  // suffix: two pushes in one millisecond must not collide (VACUUM INTO refuses to overwrite)
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

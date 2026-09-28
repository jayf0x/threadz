import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BUILTIN, type Driver, initSchema } from "@threadz/core";
import { bunDriver } from "@threadz/core/bun";
import { HttpError } from "./model";

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

// A live message's thread and its note's live-or-pinned content -- what "Ask about this message"
// (wave 6 phase 2) needs to build the model's context. Not exported from core/queries.ts (its
// `resolveVersion` is private), so this is the same two-step lookup `resolveLiveVersionId` does on
// the frontend, replicated here for the same reason that one is: it's not part of core's query surface.
export const getMessageContent = async (
  d: Driver,
  messageId: string,
): Promise<{ threadId: string; content: string } | null> => {
  const [row] = await d.all<{ thread_id: string; note_id: string; pin_version_id: string | null }>(
    `SELECT m.thread_id, m.note_id, m.pin_version_id FROM messages m
     JOIN entities e ON e.id = m.id
     WHERE m.id = ? AND m.removed_at IS NULL AND e.deleted_at IS NULL`,
    [messageId],
  );
  if (!row) return null;
  const [v] = row.pin_version_id
    ? await d.all<{ content: string }>("SELECT content FROM note_versions WHERE id = ?", [row.pin_version_id])
    : await d.all<{ content: string }>(
        "SELECT content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        [row.note_id],
      );
  if (!v) return null;
  return { threadId: row.thread_id, content: v.content };
};

// The live `attached` link for a message, if any -- same "one per message, DB-enforced" check
// `frontend/src/lib/data.ts`'s `addAnnotation` makes before writing, replicated here since this is
// the exact same write mechanism (a note + a link carrying the built-in `attached` property value),
// just triggered by an AI answer instead of user typing (AGENTS.md: "Links have no kind column").
const attachedLinkForMessage = async (d: Driver, messageId: string) => {
  const [row] = await d.all<{ id: string }>(
    `SELECT l.id FROM links l
     JOIN entities le ON le.id = l.id
     JOIN entities ne ON ne.id = l.from_id
     JOIN property_values pv ON pv.target_id = l.id AND pv.set_id = ? AND pv.removed_at IS NULL
     WHERE l.to_id = ? AND le.deleted_at IS NULL AND ne.deleted_at IS NULL`,
    [BUILTIN.attached, messageId],
  );
  return row ?? null;
};

// Attach a new assistant-authored note to a message: entity(note) + note_versions(one row) +
// entity(link) + links(from=note,to=message) + property_values(the built-in `attached` value) --
// the same four/five-row shape `addAnnotation` writes on the phone, run here on main instead so
// "Ask about this message"'s answer becomes an attached note rather than a reply appended to the
// thread (see AGENTS.md's Ask description and the `attached` built-in property set in core/schema.ts).
// Throws (never silently overwrites) if the message already has one, same as `addAnnotation`.
export const attachNoteToMessage = async (
  d: Driver,
  messageId: string,
  content: string,
  at: number,
): Promise<{ noteId: string }> => {
  if (await attachedLinkForMessage(d, messageId))
    throw new HttpError(409, `message ${messageId} already has an attached note`);
  const noteId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  await d.run(
    "INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, 'note', ?, ?, NULL, NULL)",
    [noteId, at, at],
  );
  await d.run(
    "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, 'assistant', ?, NULL)",
    [crypto.randomUUID(), noteId, content, at],
  );
  await d.run(
    "INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, 'link', ?, ?, NULL, NULL)",
    [linkId, at, at],
  );
  await d.run(
    "INSERT INTO links (id, from_id, to_id, pin_version_id, updated_at, rev) VALUES (?, ?, ?, NULL, ?, NULL)",
    [linkId, noteId, messageId, at],
  );
  await d.run(
    "INSERT INTO property_values (id, set_id, target_id, value, created_at, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)",
    [crypto.randomUUID(), BUILTIN.attached, linkId, at, at],
  );
  return { noteId };
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

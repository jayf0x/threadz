import "../frontend/node_modules/fake-indexeddb/auto"; // workspace dep lives under frontend/
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { threadView } from "@threadz/core";

// v2 (docs/direction.md "Data model" + "Sync"): main is core/'s shared schema, reached only through
// /api/changes, /api/push, /api/ask and /api/images/:hash. The old threads/messages/annotations
// endpoints (and the frontend's local-mode integration suite that exercised them: local.ts,
// handoff.ts, mode.ts, api.ts) are gone with the v1 schema they were built on -- putting the phone
// on core/ (docs/direction.md "D. Then rebuild" #3) is a separate, later step, not part of D2a.

// Isolated DB + stubbed model seam BEFORE importing anything that touches them.
// Only the model seam is mocked — real db + real sync/merge logic run against it.
const DB_PATH = `${tmpdir()}/threadz-test-${crypto.randomUUID()}.sqlite`;
process.env.THREADZ_DB = DB_PATH;
const BACKUP_DIR = `${DB_PATH}.backups`;
process.env.THREADZ_BACKUPS = BACKUP_DIR;
const IMAGES_DIR = `${DB_PATH}.images`;
process.env.THREADZ_IMAGES = IMAGES_DIR;

// Spread the real module first so a new export in model.ts never breaks the suite (and HttpError stays real).
const realModel = { ...(await import("../backend/model.ts")) }; // captured before the mock replaces it
mock.module("../backend/model.ts", () => ({
  ...realModel,
  CLAUDE_MODEL: "test-model",
  askModel: async (opts: { messages: { content: string }[] }) => ({
    text: `stub answer to: ${opts.messages.at(-1)?.content}`,
  }),
}));

const { db, driver } = await import("../backend/db.ts");
const { collectOrphanImages } = await import("../backend/images.ts");

let BASE = "";
let server: { port: number; stop: () => void };

beforeAll(async () => {
  process.env.PORT = "0"; // any free port
  server = (await import("../backend/server.ts")).default as never;
  BASE = `http://localhost:${server.port}`;
});
afterAll(() => {
  server?.stop?.();
  db.close();
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  rmSync(IMAGES_DIR, { recursive: true, force: true });
});

const push = (body: unknown) =>
  fetch(`${BASE}/api/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const pull = (since: number) => fetch(`${BASE}/api/changes?since=${since}`).then((r) => r.json());

// One thread + one message, built as the four-row shape core/core.test.ts's own test helper uses
// (entity(note) + note_versions + entity(message) + messages), pushed exactly as a device would.
const seedThread = (threadId: string, noteId: string, versionId: string, messageId: string, text: string) => {
  const at = Date.now() - 10_000;
  return push({
    entities: [
      { id: threadId, kind: "thread", created_at: at, updated_at: at, deleted_at: null, rev: null },
      { id: noteId, kind: "note", created_at: at, updated_at: at, deleted_at: null, rev: null },
      { id: messageId, kind: "message", created_at: at, updated_at: at, deleted_at: null, rev: null },
    ],
    threads: [{ id: threadId, title: "seeded thread", updated_at: at, rev: null }],
    note_versions: [
      { id: versionId, note_id: noteId, parent_id: null, content: text, author: "user", created_at: at, rev: null },
    ],
    messages: [
      {
        id: messageId,
        thread_id: threadId,
        note_id: noteId,
        pin_version_id: null,
        updated_at: at,
        removed_at: null,
        rev: null,
      },
    ],
  });
};

describe("POST /api/push + GET /api/changes (docs/direction.md 'Sync': diffs only, rev as the cursor)", () => {
  test("a pushed changeset comes back stamped, lands through core's own query layer, and a pull since that cursor sees nothing new", async () => {
    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const res = await seedThread(threadId, noteId, versionId, messageId, "hello from the device");
    expect(res.cursor).toBeGreaterThan(0);
    const pushedThread = res.changes.threads.find((t: { id: string }) => t.id === threadId);
    expect(pushedThread?.rev).toBe(res.cursor); // returned rows are stamped, not left pending

    const view = await threadView(driver, threadId);
    expect(view).toHaveLength(1);
    expect(view[0]?.version.content).toBe("hello from the device");

    const before = await pull(res.cursor - 1);
    expect(before.changes.threads.some((t: { id: string }) => t.id === threadId)).toBe(true);
    const after = await pull(res.cursor);
    expect(after.changes.threads).toEqual([]);
    expect(after.changes.messages).toEqual([]);
    expect(after.cursor).toBeGreaterThanOrEqual(res.cursor);
  });

  test("a replayed push is idempotent: no duplicate rows, content unchanged", async () => {
    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const body = {
      entities: [
        { id: threadId, kind: "thread", created_at: 1, updated_at: 1, deleted_at: null, rev: null },
        { id: noteId, kind: "note", created_at: 1, updated_at: 1, deleted_at: null, rev: null },
        { id: messageId, kind: "message", created_at: 1, updated_at: 1, deleted_at: null, rev: null },
      ],
      threads: [{ id: threadId, title: "replay me", updated_at: 1, rev: null }],
      note_versions: [
        { id: versionId, note_id: noteId, parent_id: null, content: "first", author: "user", created_at: 1, rev: null },
      ],
      messages: [
        {
          id: messageId,
          thread_id: threadId,
          note_id: noteId,
          pin_version_id: null,
          updated_at: 1,
          removed_at: null,
          rev: null,
        },
      ],
    };
    await push(body);
    await push(body); // exact replay, e.g. after a crash before the client saw the response
    const view = await threadView(driver, threadId);
    expect(view).toHaveLength(1); // not duplicated
    expect(view[0]?.version.content).toBe("first");
  });

  test("since defaults to 0 and rejects a negative/non-numeric value with a 400, never a 500", async () => {
    const all = await fetch(`${BASE}/api/changes`).then((r) => r.json());
    expect(Array.isArray(all.changes.entities)).toBe(true);
    expect((await fetch(`${BASE}/api/changes?since=-1`)).status).toBe(400);
    expect((await fetch(`${BASE}/api/changes?since=nope`)).status).toBe(400);
  });

  test("a malformed push body (invalid JSON, or the wrong shape) is a 400, not a 500", async () => {
    const bad = await fetch(`${BASE}/api/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("body must be valid JSON");

    const wrongShape = await fetch(`${BASE}/api/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entities: "not an array" }),
    });
    expect(wrongShape.status).toBe(400);
  });

  test("a push backs main up first, but only when it actually carries rows", async () => {
    const before = existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).length : 0;
    await push({}); // empty push: nothing to back up
    const afterEmpty = existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).length : 0;
    expect(afterEmpty).toBe(before);

    // Retention is by time (backend/db.ts's `selectBackupsToKeep`, docs/direction.md "B8"), so a
    // non-empty push within the same hour as an earlier backup can collapse the directory back to
    // one file rather than growing it -- that's the whole point (hourly-for-a-day thinning). What a
    // real push must still guarantee is a *fresh* backup taken just now, so assert on recency
    // instead of a strictly growing count.
    const beforeNewest = Math.max(0, ...readdirSync(BACKUP_DIR).map((f) => statSync(`${BACKUP_DIR}/${f}`).mtimeMs));
    const threadId = crypto.randomUUID();
    await push({
      entities: [{ id: threadId, kind: "thread", created_at: 1, updated_at: 1, deleted_at: null, rev: null }],
      threads: [{ id: threadId, title: "backup check", updated_at: 1, rev: null }],
    });
    const files = readdirSync(BACKUP_DIR);
    expect(files.length).toBeGreaterThan(0);
    const newest = Math.max(...files.map((f) => statSync(`${BACKUP_DIR}/${f}`).mtimeMs));
    expect(newest).toBeGreaterThan(beforeNewest);
  });

  test("a tombstoned entity travels like any other row, and is undone if newer content lands beneath it ('content wins')", async () => {
    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await seedThread(threadId, noteId, versionId, messageId, "will be deleted");

    const deletedAt = Date.now();
    await push({
      entities: [
        { id: threadId, kind: "thread", created_at: 1, updated_at: deletedAt, deleted_at: deletedAt, rev: null },
      ],
    });
    const [row] = await driver.all<{ deleted_at: number | null }>("SELECT deleted_at FROM entities WHERE id = ?", [
      threadId,
    ]);
    expect(row?.deleted_at).toBe(deletedAt);

    // A newer message arriving afterwards revives the thread (core/merge.ts's reviveThreads).
    const laterMessageId = crypto.randomUUID();
    const laterNoteId = crypto.randomUUID();
    const laterVersionId = crypto.randomUUID();
    const revivedAt = deletedAt + 1000;
    await push({
      entities: [
        { id: laterNoteId, kind: "note", created_at: revivedAt, updated_at: revivedAt, deleted_at: null, rev: null },
        {
          id: laterMessageId,
          kind: "message",
          created_at: revivedAt,
          updated_at: revivedAt,
          deleted_at: null,
          rev: null,
        },
      ],
      note_versions: [
        {
          id: laterVersionId,
          note_id: laterNoteId,
          parent_id: null,
          content: "revived",
          author: "user",
          created_at: revivedAt,
          rev: null,
        },
      ],
      messages: [
        {
          id: laterMessageId,
          thread_id: threadId,
          note_id: laterNoteId,
          pin_version_id: null,
          updated_at: revivedAt,
          removed_at: null,
          rev: null,
        },
      ],
    });
    const [revived] = await driver.all<{ deleted_at: number | null }>("SELECT deleted_at FROM entities WHERE id = ?", [
      threadId,
    ]);
    expect(revived?.deleted_at).toBeNull();
  });
});

describe("POST /api/ask (docs/direction.md 'B10': push -> ask -> main writes question+answer as notes -> pull)", () => {
  test("writes the question and the answer as new note+message rows, in order, after the existing transcript", async () => {
    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await seedThread(threadId, noteId, versionId, messageId, "the existing note in this thread");

    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, question: "what should I do next" }),
    }).then((r) => r.json());

    expect(res.answer).toContain("stub answer to: what should I do next");
    expect(res.cursor).toBeGreaterThan(0);
    // The response already carries the stamped rows a client would otherwise have to pull for.
    expect(res.changes.note_versions).toHaveLength(2);

    const view = await threadView(driver, threadId);
    expect(view.map((r) => r.version.content)).toEqual([
      "the existing note in this thread",
      "what should I do next",
      "stub answer to: what should I do next",
    ]);
    expect(view.map((r) => r.version.author)).toEqual(["user", "user", "assistant"]);
  });

  test("404s on an unknown thread, 400s on a missing threadId/question", async () => {
    const ghost = crypto.randomUUID();
    const missingThread = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: ghost, question: "hi" }),
    });
    expect(missingThread.status).toBe(404);

    const noQuestion = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: ghost }),
    });
    expect(noQuestion.status).toBe(400);
  });

  test("a deleted thread 404s before ever reaching the model or writing anything", async () => {
    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await seedThread(threadId, noteId, versionId, messageId, "soon deleted");
    const deletedAt = Date.now();
    await push({
      entities: [
        { id: threadId, kind: "thread", created_at: 1, updated_at: deletedAt, deleted_at: deletedAt, rev: null },
      ],
    });

    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, question: "hi" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("images (invariant: immutable files on main, outside SQLite; orphan GC now reads note_versions)", () => {
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) =>
    i === 0 ? 0xff : i === 1 ? 0xd8 : i === 2 ? 0xff : (i * 7) % 251,
  );
  const hashOf = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  const put = (h: string, body: Uint8Array) => fetch(`${BASE}/api/images/${h}`, { method: "PUT", body });

  test("PUT then GET is byte-identical; a replayed PUT changes nothing", async () => {
    const hash = hashOf(bytes);
    const first = await put(hash, bytes);
    expect((await first.json()).stored).toBe(true);
    const got = await fetch(`${BASE}/api/images/${hash}`);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await (await put(hash, bytes)).json()).stored).toBe(false);
    // Referenced from a note so the orphan GC test below (which jumps the clock 8 days forward)
    // never has to treat this describe block's own fixture image as an unrelated stray orphan.
    await seedThread(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      `![](img:${hash}#4x3)`,
    );
  });

  test("rejects a body that is not the hash it claims, or is not a JPEG", async () => {
    const hash = hashOf(bytes);
    const other = Uint8Array.from(bytes, (b, i) => (i === 100 ? b ^ 1 : b));
    expect((await put(hash, other)).status).toBe(400);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect((await put(hashOf(png), png)).status).toBe(415);
  });

  test("orphan GC keeps a hash referenced from any note_versions row, drops an old unreferenced one", async () => {
    const jpeg = (n: number) => Uint8Array.from({ length: 300 }, (_, i) => [0xff, 0xd8, 0xff][i] ?? (i * n) % 251);
    const [used, oldOrphan, freshOrphan] = [jpeg(3), jpeg(7), jpeg(11)];
    const [hUsed, hOld, hFresh] = [used, oldOrphan, freshOrphan].map(hashOf) as [string, string, string];
    for (const [h, b] of [
      [hUsed, used],
      [hOld, oldOrphan],
      [hFresh, freshOrphan],
    ] as const)
      await put(h, b);

    const threadId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await seedThread(threadId, noteId, versionId, messageId, `a photo ![](img:${hUsed}#4x3)`);

    const later = Date.now() + 8 * 24 * 3600 * 1000;
    utimesSync(`${IMAGES_DIR}/${hFresh}`, new Date(later + 1000), new Date(later + 1000));

    expect(collectOrphanImages(later)).toEqual([hOld]);
    expect(existsSync(`${IMAGES_DIR}/${hOld}`)).toBe(false);
    expect(existsSync(`${IMAGES_DIR}/${hUsed}`)).toBe(true);
    expect(existsSync(`${IMAGES_DIR}/${hFresh}`)).toBe(true);
  });
});

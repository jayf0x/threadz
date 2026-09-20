import "../frontend/node_modules/fake-indexeddb/auto"; // workspace dep lives under frontend/
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";

// Isolated DB + stubbed model seam BEFORE importing anything that touches them.
// Only the model seam is mocked — real db + real metadata logic run against it.
const DB_PATH = `/tmp/threadz-test-${crypto.randomUUID()}.sqlite`;
process.env.THREADZ_DB = DB_PATH;
const BACKUP_DIR = `${DB_PATH}.backups`;
process.env.THREADZ_BACKUPS = BACKUP_DIR;

// Tests tweak these to drive the (mocked) local model.
let genOutput: unknown = { description: "a real description of the thread", tags: ["alpha", "beta"] };
const EMBED_VEC = Float32Array.from([0.1, -0.2, 0.3, 0.4, -0.5, 0.6, 0.7, -0.8]);

mock.module("../backend/model.ts", () => ({
  CLAUDE_MODEL: "test-model",
  askModel: async (opts: { messages: { content: string }[] }) => ({
    text: `stub answer to: ${opts.messages.at(-1)?.content}`,
  }),
  ollamaGenerateJson: async () => genOutput,
  embed: async (texts: string[]) => texts.map(() => Float32Array.from(EMBED_VEC)),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { appendMessage, createThread, db, getMessages, getThread, threadEmbeddings } = await import("../backend/db.ts");
const { generateMetadata, looksLikeGarbage, MIN_WORDS } = await import("../backend/metadata.ts");

const BASE = "http://localhost:8788";
let server: { stop: () => void };

beforeAll(async () => {
  process.env.PORT = "8788";
  server = (await import("../backend/server.ts")).default as never;
  await new Promise((r) => setTimeout(r, 50)); // let Bun.serve bind
});
afterAll(() => {
  server?.stop?.();
  db.close();
  rmSync(BACKUP_DIR, { recursive: true, force: true });
});

describe("idempotent append (invariant: threads append-only, dedupe on client UUID)", () => {
  test("same id twice inserts once", () => {
    createThread("t1", "T1");
    const id = crypto.randomUUID();
    const a = appendMessage({ id, threadId: "t1", role: "user", content: "hello" });
    const b = appendMessage({ id, threadId: "t1", role: "user", content: "hello again" });
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(getMessages("t1")).toHaveLength(1);
    expect(getMessages("t1")[0].content).toBe("hello"); // committed message never edited
  });

  test("seq increases in append order", () => {
    createThread("t2", "T2");
    appendMessage({ id: crypto.randomUUID(), threadId: "t2", role: "user", content: "1" });
    appendMessage({ id: crypto.randomUUID(), threadId: "t2", role: "assistant", content: "2" });
    appendMessage({ id: crypto.randomUUID(), threadId: "t2", role: "user", content: "3" });
    expect(getMessages("t2").map((m) => [m.seq, m.content])).toEqual([
      [1, "1"],
      [2, "2"],
      [3, "3"],
    ]);
  });
});

describe("metadata generation (bug: gemma3:270m parroted the prompt into the DB)", () => {
  test("looksLikeGarbage flags echoed instructions, passes real text", () => {
    expect(looksLikeGarbage("one sentence, <=140 chars")).toBe(true);
    expect(looksLikeGarbage("3-6 short lowercase topic tags")).toBe(true);
    expect(looksLikeGarbage("string")).toBe(true);
    expect(looksLikeGarbage("Notes on sourdough hydration and cold-proof timing.")).toBe(false);
    expect(looksLikeGarbage("baking")).toBe(false);
  });

  test("thin thread (< MIN_WORDS) is skipped — no invented metadata", async () => {
    createThread("m-thin", "hi");
    genOutput = { description: "the model would have hallucinated this", tags: ["nope"] };
    await generateMetadata("m-thin");
    const t = getThread("m-thin")!;
    expect(t.description).toBe("");
    expect(JSON.parse(t.tags!)).toEqual([]);
    expect(t.embedding).not.toBeNull(); // still embedded (of the title) so search works
  });

  test("garbage model output is rejected, thread stays clean", async () => {
    createThread("m-garbage", "Postgres index bloat on the orders table");
    appendMessage({
      id: crypto.randomUUID(),
      threadId: "m-garbage",
      role: "user",
      content: "weighing pg_repack vs reindex",
    });
    genOutput = { description: "one sentence, <=140 chars", tags: ["3-6 short lowercase topic tags"] };
    await generateMetadata("m-garbage");
    const t = getThread("m-garbage")!;
    expect(t.description).toBe("");
    expect(JSON.parse(t.tags!)).toEqual([]);
  });

  test("good model output is stored", async () => {
    createThread("m-good", "Postgres index bloat on the orders table");
    appendMessage({
      id: crypto.randomUUID(),
      threadId: "m-good",
      role: "user",
      content: "weighing pg_repack vs reindex",
    });
    genOutput = {
      description: "Notes on Postgres index bloat and repack strategy.",
      tags: ["Postgres", "Index", " bloat "],
    };
    await generateMetadata("m-good");
    const t = getThread("m-good")!;
    expect(t.description).toBe("Notes on Postgres index bloat and repack strategy.");
    expect(JSON.parse(t.tags!)).toEqual(["postgres", "index", "bloat"]); // lowercased + trimmed
  });

  test("MIN_WORDS is a sane threshold", () => {
    expect(MIN_WORDS).toBeGreaterThan(0);
    expect(MIN_WORDS).toBeLessThan(20);
  });
});

describe("embedding blob round-trips through SQLite (bug risk: Float32/Uint8 buffer aliasing)", () => {
  test("stored vector reads back byte-for-byte", async () => {
    createThread("m-embed", "A thread with enough words to earn real metadata here");
    genOutput = { description: "desc", tags: ["x"] };
    await generateMetadata("m-embed");
    const row = threadEmbeddings().find((r) => r.id === "m-embed");
    expect(row).toBeDefined();
    expect(Array.from(row!.vec)).toEqual(Array.from(EMBED_VEC));
  });
});

describe("HTTP e2e", () => {
  test("create → append → fetch round-trips, then delete cleans up", async () => {
    const created = await fetch(`${BASE}/api/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "__e2e__ roundtrip" }),
    }).then((r) => r.json());
    expect(created.id).toBeString();

    const mid = crypto.randomUUID();
    for (let i = 0; i < 2; i++) {
      await fetch(`${BASE}/api/threads/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mid, content: "round trip please" }),
      });
    }

    const got = await fetch(`${BASE}/api/threads/${created.id}`).then((r) => r.json());
    expect(got.messages).toHaveLength(1);
    expect(got.messages[0].content).toBe("round trip please");

    const del = await fetch(`${BASE}/api/threads/${created.id}`, { method: "DELETE" }).then((r) => r.json());
    expect(del.ok).toBe(true);
    expect((await fetch(`${BASE}/api/threads/${created.id}`)).status).toBe(404);
  });

  test("committing an ask appends user+assistant at commit time (not backdated)", async () => {
    const created = await fetch(`${BASE}/api/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "__e2e__ ask thread with plenty of words" }),
    }).then((r) => r.json());

    genOutput = { description: "d", tags: ["t"] };
    const res = await fetch(`${BASE}/api/threads/${created.id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "what is 2+2", commit: true }),
    }).then((r) => r.json());
    expect(res.committed).toBe(true);
    expect(res.answer).toContain("stub answer");

    const got = await fetch(`${BASE}/api/threads/${created.id}`).then((r) => r.json());
    expect(got.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);

    // metadata fires on commit (fire-and-forget) — poll briefly
    let described = false;
    for (let i = 0; i < 20 && !described; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const t = await fetch(`${BASE}/api/threads/${created.id}`).then((r) => r.json());
      described = t.thread.description === "d";
    }
    expect(described).toBe(true);

    await fetch(`${BASE}/api/threads/${created.id}`, { method: "DELETE" });
  });

  test("scratch ask (commit:false) appends nothing", async () => {
    const created = await fetch(`${BASE}/api/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "__e2e__ scratch" }),
    }).then((r) => r.json());

    await fetch(`${BASE}/api/threads/${created.id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "disposable", commit: false }),
    });
    const got = await fetch(`${BASE}/api/threads/${created.id}`).then((r) => r.json());
    expect(got.messages).toHaveLength(0);
    await fetch(`${BASE}/api/threads/${created.id}`, { method: "DELETE" });
  });
});

describe("backend accepts what a syncing device sends", () => {
  const post = (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("thread create is idempotent on id and keeps the client's createdAt (never the future)", async () => {
    const id = crypto.randomUUID();
    const past = Date.now() - 86_400_000;
    const a = await post("/api/threads", { id, title: "__e2e__ replay", createdAt: past }).then((r) => r.json());
    const b = await post("/api/threads", { id, title: "__e2e__ replay" }); // second replay must not 500
    expect(b.status).toBe(200);
    expect(a.createdAt).toBe(past);

    const mid = crypto.randomUUID();
    const m = await post(`/api/threads/${id}/messages`, {
      id: mid,
      content: "from the past",
      createdAt: past + 1000,
    }).then((r) => r.json());
    expect(m.message.createdAt).toBe(past + 1000);
    const future = await post(`/api/threads/${id}/messages`, {
      id: crypto.randomUUID(),
      content: "future",
      createdAt: Date.now() + 9e9,
    }).then((r) => r.json());
    expect(future.message.createdAt).toBeLessThanOrEqual(Date.now());

    const snap = await fetch(`${BASE}/api/snapshot`).then((r) => r.json());
    expect(snap.messages.some((x: { id: string }) => x.id === mid)).toBe(true);
    await fetch(`${BASE}/api/threads/${id}`, { method: "DELETE" });
  });
});

describe("POST /api/sync (invariant: a device's work lands atomically, after a backup, never destroying unseen edits)", () => {
  const sync = (body: unknown) =>
    fetch(`${BASE}/api/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const head = () => fetch(`${BASE}/api/head`).then((r) => r.json());

  test("applies threads + notes, is idempotent, backs main up first, and reports matching hashes", async () => {
    const id = crypto.randomUUID();
    const mid = crypto.randomUUID();
    const payload = {
      threads: [{ id, title: "__sync__ one" }],
      messages: [{ id: mid, threadId: id, content: "offline note", createdAt: Date.now() - 5000 }],
      deletes: [],
    };
    const a = await sync(payload);
    expect([a.created, a.appended]).toEqual([1, 1]);
    expect(existsSync(BACKUP_DIR) && readdirSync(BACKUP_DIR).length).toBeGreaterThan(0);

    const b = await sync(payload); // replay after a crash: nothing new
    expect([b.created, b.appended]).toEqual([0, 0]);

    const h = await head();
    expect(h.threads[id]).toBe(a.hashes[id]);
    expect(h.head).toBe(b.head);
    await sync({ threads: [], messages: [], deletes: [{ id, baseHash: h.threads[id] }] });
  });

  test("a delete only applies if main is unchanged since the device's base", async () => {
    const id = crypto.randomUUID();
    const first = await sync({ threads: [{ id, title: "__sync__ del" }], messages: [], deletes: [] });
    const stale = first.hashes[id];
    await sync({
      threads: [],
      messages: [{ id: crypto.randomUUID(), threadId: id, content: "added elsewhere" }],
      deletes: [],
    });

    const r = await sync({ threads: [], messages: [], deletes: [{ id, baseHash: stale }] });
    expect(r.kept).toEqual([id]); // main moved on: the thread survives
    expect((await fetch(`${BASE}/api/threads/${id}`)).status).toBe(200);

    const now = (await head()).threads[id];
    const ok = await sync({ threads: [], messages: [], deletes: [{ id, baseHash: now }] });
    expect(ok.deleted).toEqual([id]);
    expect((await fetch(`${BASE}/api/threads/${id}`)).status).toBe(404);
  });

  test("notes for a thread main no longer has are reported, not invented", async () => {
    const ghost = crypto.randomUUID();
    const r = await sync({
      threads: [],
      messages: [{ id: crypto.randomUUID(), threadId: ghost, content: "orphan" }],
      deletes: [],
    });
    expect(r.missing).toEqual([ghost]);
    expect((await fetch(`${BASE}/api/threads/${ghost}`)).status).toBe(404);
  });
});

// The device-side store. Invariant: nothing the user wrote on this device is ever lost —
// not to a sync, a retry, a crash mid-sync, a delete on main, or main going away mid-write.
describe("local mode (invariant: no data lost across sync)", () => {
  // Minimal browser surface for the frontend lib modules; IndexedDB comes from fake-indexeddb.
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: { addEventListener() {} },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  process.env.VITE_BACKEND_URL = BASE;

  let local: typeof import("../frontend/src/lib/local");
  let handoff: typeof import("../frontend/src/lib/handoff");
  let remote: typeof import("../frontend/src/lib/api");
  let modeLib: typeof import("../frontend/src/lib/mode");
  beforeAll(async () => {
    local = await import("../frontend/src/lib/local");
    handoff = await import("../frontend/src/lib/handoff");
    remote = await import("../frontend/src/lib/api");
    modeLib = await import("../frontend/src/lib/mode");
  });

  const mainGet = (id: string) => fetch(`${BASE}/api/threads/${id}`);
  const mainDelete = (id: string) => fetch(`${BASE}/api/threads/${id}`, { method: "DELETE" });
  const mainAppend = (id: string, content: string) =>
    fetch(`${BASE}/api/threads/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), content }),
    });
  const contents = async (id: string) =>
    (await mainGet(id).then((r) => r.json())).messages.map((m: { content: string }) => m.content);
  const localContents = async (id: string) => (await local.localApi.getThread(id)).messages.map((m) => m.content);
  const cleanUp = async (...ids: string[]) => {
    for (const id of ids) {
      await mainDelete(id);
      await local.localApi.deleteThread(id).catch(() => {});
    }
    await handoff.syncNow();
  };

  test("append dedupes on id and seq follows append order", async () => {
    const t = await local.localApi.createThread({ title: "__local__ seq" });
    const mid = crypto.randomUUID();
    const a = await local.localApi.appendMessage(t.id, { id: mid, content: "one" });
    const b = await local.localApi.appendMessage(t.id, { id: mid, content: "one again" });
    await local.localApi.appendMessage(t.id, { id: crypto.randomUUID(), content: "two" });
    expect([a.inserted, b.inserted]).toEqual([true, false]);
    expect((await local.localApi.getThread(t.id)).messages.map((m) => [m.seq, m.content])).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
    await cleanUp(t.id);
  });

  test("sync sends threads, notes and original timestamps; a replay adds nothing; the device keeps its copy", async () => {
    const t = await local.localApi.createThread({ title: "__local__ push", seed: "seed note" });
    const past = Date.now() - 3_600_000;
    const mid = crypto.randomUUID();
    await local.localApi.appendMessage(t.id, { id: mid, content: "captured offline", createdAt: past });
    // Crash between "main got it" and "device marked it": main already has it, the device still thinks it's pending.
    await remote.remoteApi.createThread({ id: t.id, title: t.title });
    await remote.remoteApi.appendMessage(t.id, { id: mid, content: "captured offline", createdAt: past });

    expect((await local.countUnsynced()).messages).toBe(2);
    const first = await handoff.syncNow();
    const second = await handoff.syncNow();
    expect(first.pushed).toBeGreaterThan(0);
    expect(second.pushed).toBe(0);

    const got = await mainGet(t.id).then((r) => r.json());
    expect(got.messages.map((m: { content: string }) => m.content).sort()).toEqual(["captured offline", "seed note"]);
    expect(got.messages.find((m: { id: string }) => m.id === mid).createdAt).toBe(past);
    expect(await local.countUnsynced()).toEqual({ threads: 0, messages: 0, deletions: 0 });
    expect(await localContents(t.id)).toHaveLength(2);
    // in sync = our base hashes are exactly main's
    expect(await local.getBase()).toEqual((await fetch(`${BASE}/api/head`).then((r) => r.json())).threads);
    await cleanUp(t.id);
  });

  test("main changes are pulled in (new thread, new note) without touching local work", async () => {
    const mine = await local.localApi.createThread({ title: "__local__ mine", seed: "mine" });
    await handoff.syncNow();
    const theirs = await fetch(`${BASE}/api/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "__local__ from another device", seed: "elsewhere" }),
    }).then((r) => r.json());
    await mainAppend(mine.id, "added on main");
    await local.localApi.appendMessage(mine.id, { id: crypto.randomUUID(), content: "added here, offline" });

    const r = await handoff.syncNow();
    expect(r.threads).toBeGreaterThanOrEqual(2);
    expect(await localContents(theirs.id)).toEqual(["elsewhere"]);
    expect((await localContents(mine.id)).sort()).toEqual(["added here, offline", "added on main", "mine"]);
    expect((await contents(mine.id)).sort()).toEqual(["added here, offline", "added on main", "mine"]); // both sides converge
    await cleanUp(mine.id, theirs.id);
  });

  test("deleted on main, edited here: the thread stays and main gets all of it back", async () => {
    const t = await local.localApi.createThread({ title: "__local__ del-vs-edit", seed: "old note" });
    await handoff.syncNow();
    await mainDelete(t.id);
    await local.localApi.appendMessage(t.id, { id: crypto.randomUUID(), content: "new note offline" });

    const r = await handoff.syncNow();
    expect(r.keptLocal).toBe(1);
    expect((await contents(t.id)).sort()).toEqual(["new note offline", "old note"]);
    await cleanUp(t.id);
  });

  test("deleted here, edited on main: the thread comes back with everything", async () => {
    const t = await local.localApi.createThread({ title: "__local__ edit-vs-del", seed: "shared" });
    await handoff.syncNow();
    await local.localApi.deleteThread(t.id);
    await mainAppend(t.id, "main kept writing");

    const r = await handoff.syncNow();
    expect(r.keptRemote).toBe(1);
    expect((await contents(t.id)).sort()).toEqual(["main kept writing", "shared"]);
    expect((await localContents(t.id)).sort()).toEqual(["main kept writing", "shared"]);
    await cleanUp(t.id);
  });

  test("deleted on main, untouched here: follows main, copy kept in trash", async () => {
    const t = await local.localApi.createThread({ title: "__local__ follow-delete", seed: "bye" });
    await handoff.syncNow();
    await mainDelete(t.id);
    const r = await handoff.syncNow();
    expect(r.removed).toBe(1);
    await expect(local.localApi.getThread(t.id)).rejects.toThrow("not found");
    expect(
      (await local.exportSnapshot()).trash!.find((x) => x.thread.id === t.id)?.messages.map((m) => m.content),
    ).toEqual(["bye"]);
  });

  test("a local delete reaches main when main is unchanged, and stays recoverable in backups", async () => {
    const t = await local.localApi.createThread({ title: "__local__ delete", seed: "keep me somewhere" });
    await handoff.syncNow();
    expect((await mainGet(t.id)).status).toBe(200);

    await local.localApi.deleteThread(t.id);
    await handoff.syncNow();
    expect((await mainGet(t.id)).status).toBe(404);
    expect(
      (await local.exportSnapshot()).trash!.find((x) => x.thread.id === t.id)?.messages.map((m) => m.content),
    ).toEqual(["keep me somewhere"]);
  });

  test("main vanishing mid-write: the note lands on the device, the app detaches, nothing is lost", async () => {
    const t = await local.localApi.createThread({ title: "__local__ cut-off", seed: "before" });
    await handoff.syncNow(); // also leaves a warm copy: replicaReady
    expect(modeLib.replicaReady()).toBe(true);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    try {
      const id = crypto.randomUUID();
      const r = await remote.api.appendMessage(t.id, { id, content: "written as the wifi died" });
      expect(r.inserted).toBe(true);
      expect(modeLib.getMode()).toBe("local");
      expect(await localContents(t.id)).toContain("written as the wifi died");
    } finally {
      globalThis.fetch = realFetch;
    }
    await handoff.goLive(); // back on purpose: syncs, then flips
    expect(modeLib.getMode()).toBe("live");
    expect(await contents(t.id)).toContain("written as the wifi died");
    await cleanUp(t.id);
  });

  test("an HTTP error from main is NOT treated as being offline", async () => {
    modeLib.setMode("live");
    await expect(remote.api.getThread(crypto.randomUUID())).rejects.toThrow("not found");
    expect(modeLib.getMode()).toBe("live");
  });

  test("importing a backup never overwrites or deletes, and restores a deleted thread", async () => {
    const t = await local.localApi.createThread({ title: "__local__ merge" });
    await local.localApi.appendMessage(t.id, { id: crypto.randomUUID(), content: "unsynced work" });
    const gone = await local.localApi.createThread({ title: "__local__ merged-away", seed: "bye" });
    await local.localApi.deleteThread(gone.id);

    await local.mergeSnapshot({
      version: 1,
      exportedAt: Date.now(),
      threads: [gone, { ...t, title: "renamed elsewhere", updatedAt: t.updatedAt + 1 }],
      messages: [],
    });
    expect((await local.localApi.getThread(t.id)).thread.title).toBe("__local__ merge"); // not overwritten
    expect(await localContents(t.id)).toEqual(["unsynced work"]); // not deleted
    expect((await local.localApi.getThread(gone.id)).thread.id).toBe(gone.id); // restored
    await cleanUp(t.id, gone.id);
  });

  test("import rejects files that aren't backups, without touching the store", async () => {
    const before = await local.exportSnapshot();
    await expect(handoff.importBackup(new File(['{"nope":1}'], "x.json"))).rejects.toThrow("Not a Threadz backup");
    expect((await local.exportSnapshot()).threads).toHaveLength(before.threads.length);
  });
});

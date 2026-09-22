import "../frontend/node_modules/fake-indexeddb/auto"; // workspace dep lives under frontend/
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";

// Isolated DB + stubbed model seam BEFORE importing anything that touches them.
// Only the model seam is mocked — real db + real metadata logic run against it.
const DB_PATH = `${tmpdir()}/threadz-test-${crypto.randomUUID()}.sqlite`;
process.env.THREADZ_DB = DB_PATH;
const BACKUP_DIR = `${DB_PATH}.backups`;
process.env.THREADZ_BACKUPS = BACKUP_DIR;
const IMAGES_DIR = `${DB_PATH}.images`;
process.env.THREADZ_IMAGES = IMAGES_DIR;
// Off by default in v1; turned on for this suite so the generation tests below actually exercise it.
// `refreshMetadata` reads it at call time, so the dedicated "off" tests can flip it back temporarily.
process.env.THREADZ_METADATA = "1";

// Tests tweak these to drive the (mocked) local model.
let genOutput: unknown = { description: "a real description of the thread", tags: ["alpha", "beta"] };
const EMBED_VEC = Float32Array.from([0.1, -0.2, 0.3, 0.4, -0.5, 0.6, 0.7, -0.8]);

// Spread the real module first so a new export in model.ts never breaks the suite (and HttpError stays real).
const realModel = { ...(await import("../backend/model.ts")) }; // captured before the mock replaces it
mock.module("../backend/model.ts", () => ({
  ...realModel,
  CLAUDE_MODEL: "test-model",
  askModel: async (opts: { messages: { content: string }[] }) => ({
    text: `stub answer to: ${opts.messages.at(-1)?.content}`,
  }),
  ollamaGenerateJson: async () => genOutput,
  embed: async (texts: string[]) => texts.map(() => Float32Array.from(EMBED_VEC)),
}));

const {
  appendAnnotation,
  appendMessage,
  backfillSearchIndex,
  backupDb,
  copyThread,
  createThread,
  db,
  dedupeDuplicateAnnotations,
  editAnnotation,
  editMessage,
  getAnnotation,
  getAnnotations,
  getAnnotationsForMessage,
  getMessages,
  getThread,
  SCHEMA,
  threadEmbeddings,
  threadHash,
} = await import("../backend/db.ts");
const { collectOrphanImages } = await import("../backend/images.ts");
const { generateMetadata, looksLikeGarbage, MIN_WORDS, stripImages } = await import("../backend/metadata.ts");

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

describe("idempotent append (invariant: threads append-only, dedupe on client UUID)", () => {
  test("same id twice inserts once", () => {
    createThread("t1", "T1");
    const id = crypto.randomUUID();
    const a = appendMessage({ id, threadId: "t1", role: "user", content: "hello" });
    const b = appendMessage({ id, threadId: "t1", role: "user", content: "hello again" });
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(getMessages("t1")).toHaveLength(1);
    expect(getMessages("t1")[0]?.content).toBe("hello"); // committed message never edited
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

describe("metadata generation is off by default (v1: no solid UI, weak output)", () => {
  test("POST /metadata and GET /related answer a clear 503, not a 500 or a silent no-op, and nothing else fires Ollama meanwhile", async () => {
    const before = process.env.THREADZ_METADATA;
    delete process.env.THREADZ_METADATA;
    try {
      const t = await fetch(`${BASE}/api/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "__e2e__ metadata off", seed: "plenty of words to summarise here" }),
      }).then((r) => r.json());

      const meta = await fetch(`${BASE}/api/threads/${t.id}/metadata`, { method: "POST" });
      expect(meta.status).toBe(503);
      expect((await meta.json()).error).toBe("metadata generation is off (set THREADZ_METADATA=1)");

      const related = await fetch(`${BASE}/api/threads/${t.id}/related`);
      expect(related.status).toBe(503);
      expect((await related.json()).error).toBe("metadata generation is off (set THREADZ_METADATA=1)");

      // an append with the flag off must never reach Ollama: description/tags/embedding stay untouched
      await new Promise((r) => setTimeout(r, 30));
      const after = await fetch(`${BASE}/api/threads/${t.id}`).then((r) => r.json());
      expect(after.thread.description).toBeNull();
      expect(after.thread.tags).toEqual([]);

      await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
    } finally {
      if (before === undefined) delete process.env.THREADZ_METADATA;
      else process.env.THREADZ_METADATA = before;
    }
  });
});

describe("images (invariant: immutable files on main, outside SQLite, snapshots and backups)", () => {
  // Not a decodable picture, but main only checks the JPEG magic bytes and the hash.
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) =>
    i === 0 ? 0xff : i === 1 ? 0xd8 : i === 2 ? 0xff : (i * 7) % 251,
  );
  const hashOf = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  const hash = hashOf(bytes);
  const put = (h: string, body: Uint8Array) => fetch(`${BASE}/api/images/${h}`, { method: "PUT", body });

  test("PUT then GET is byte-identical, cacheable forever; a replayed PUT changes nothing", async () => {
    const first = await put(hash, bytes);
    expect(first.status).toBe(200);
    expect((await first.json()).stored).toBe(true);
    const file = `${IMAGES_DIR}/${hash}`;
    const before = statSync(file).mtimeMs;

    const got = await fetch(`${BASE}/api/images/${hash}`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

    await new Promise((r) => setTimeout(r, 15));
    expect((await (await put(hash, bytes)).json()).stored).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
    expect(readdirSync(IMAGES_DIR)).toEqual([hash]); // no temp files left behind
  });

  test("rejects a body that is not the hash it claims, not a JPEG, or a hash that is not a hash", async () => {
    const other = Uint8Array.from(bytes, (b, i) => (i === 100 ? b ^ 1 : b));
    expect((await put(hash, other)).status).toBe(400);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect((await put(hashOf(png), png)).status).toBe(415);
    expect((await put("not-a-hash", bytes)).status).toBe(400);
    expect((await fetch(`${BASE}/api/images/${"b".repeat(64)}`)).status).toBe(404);
    expect(readdirSync(IMAGES_DIR)).toEqual([hash]);
  });

  test("CORS allows PUT from the app's origin", async () => {
    const r = await fetch(`${BASE}/api/images/${hash}`, { method: "OPTIONS" });
    expect(r.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  test("images are in neither /api/snapshot nor a backupDb() copy", async () => {
    const t = createThread("img-t", "photo thread");
    appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: `look ![](img:${hash}#40x30)` });
    const snap = JSON.stringify(await (await fetch(`${BASE}/api/snapshot`)).json());
    expect(snap).toContain(`img:${hash}`); // the reference is text …
    expect(snap).not.toContain("/9j/"); // … no base64 JPEG
    const copy = readFileSync(backupDb());
    expect(copy.includes(bytes.slice(0, 256))).toBe(false); // … and the bytes never reach a database copy
    expect(readdirSync(BACKUP_DIR).some((f) => f === hash)).toBe(false);
  });

  test("orphan GC removes only old files no message (or kept edit) refers to", async () => {
    const jpeg = (n: number) => Uint8Array.from({ length: 300 }, (_, i) => [0xff, 0xd8, 0xff][i] ?? (i * n) % 251);
    const [used, edited, oldOrphan, freshOrphan] = [jpeg(3), jpeg(5), jpeg(7), jpeg(11)];
    const [hUsed, hEdited, hOld, hFresh] = [used, edited, oldOrphan, freshOrphan].map(hashOf) as [
      string,
      string,
      string,
      string,
    ];
    for (const [h, b] of [
      [hUsed, used],
      [hEdited, edited],
      [hOld, oldOrphan],
      [hFresh, freshOrphan],
    ] as const)
      await put(h, b);
    const t = createThread("gc-t", "gc thread");
    appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: `![](img:${hUsed}#4x3)` });
    const m = crypto.randomUUID();
    appendMessage({ id: m, threadId: t.id, role: "user", content: `first ![](img:${hEdited}#4x3)` });
    db.query("UPDATE messages SET content = 'rewritten', edits = ? WHERE id = ?").run(
      JSON.stringify([{ content: `first ![](img:${hEdited}#4x3)`, at: 1 }]),
      m,
    );
    const later = Date.now() + 8 * 24 * 3600 * 1000;
    // pretend 8 days have passed for everything but the "fresh" one
    const dir = `${IMAGES_DIR}`;
    utimesSync(`${dir}/${hFresh}`, new Date(later + 1000), new Date(later + 1000));

    expect(collectOrphanImages(later)).toEqual([hOld]);
    expect(readdirSync(dir).sort()).toEqual(
      [hEdited, hFresh, hUsed, hash].filter((h) => existsSync(`${dir}/${h}`)).sort(),
    );
    expect(existsSync(`${dir}/${hOld}`)).toBe(false);
    expect(existsSync(`${dir}/${hUsed}`)).toBe(true);
    expect(existsSync(`${dir}/${hEdited}`)).toBe(true);
  });

  test("image markdown is stripped from what the metadata model reads", () => {
    expect(stripImages(`a walk ![](img:${hash}#40x30) in the park\n![alt](https://x/y.png)`)).toBe(
      "a walk  in the park\n",
    );
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

describe("request bodies are validated (a wrong type is the caller's 400, never a 500)", () => {
  const send = (method: string, path: string, body: string) =>
    fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body });
  const create = (title: string) =>
    send("POST", "/api/threads", JSON.stringify({ title })).then((r) => r.json() as Promise<{ id: string }>);

  test("non-JSON and wrong-typed bodies get a 400 with a short message", async () => {
    const bad = await send("POST", "/api/threads", "not json");
    expect([bad.status, (await bad.json()).error]).toEqual([400, "body must be valid JSON"]);

    const wrongType = await send("POST", "/api/threads", JSON.stringify({ title: 5 }));
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json()).error).toStartWith("title:");

    const t = await create("__e2e__ validation");
    const badRole = await send(
      "POST",
      `/api/threads/${t.id}/messages`,
      JSON.stringify({ id: "x", content: "hi", role: "root" }),
    );
    expect(badRole.status).toBe(400);
    expect((await badRole.json()).error).toStartWith("role:");
    expect((await send("PATCH", `/api/threads/${t.id}`, JSON.stringify({ title: ["a"] }))).status).toBe(400);
    expect((await send("POST", `/api/threads/${t.id}/ask`, JSON.stringify({ prompt: 1 }))).status).toBe(400);
    expect(getMessages(t.id)).toHaveLength(0);

    const syncBadRole = await send(
      "POST",
      "/api/sync",
      JSON.stringify({ messages: [{ id: "m", threadId: t.id, content: "x", role: "system" }] }),
    );
    expect(syncBadRole.status).toBe(400);
    expect((await send("POST", "/api/sync", "[]")).status).toBe(400);
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("the handlers' own missing-field messages are unchanged", async () => {
    const t = await create("__e2e__ missing");
    const noContent = await send("POST", `/api/threads/${t.id}/messages`, "{}");
    expect([noContent.status, (await noContent.json()).error]).toEqual([400, "id and content are required"]);
    const noPrompt = await send("POST", `/api/threads/${t.id}/ask`, "{}");
    expect((await noPrompt.json()).error).toBe("prompt is required");
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("responses carry no `source` field", async () => {
    const t = await create("__e2e__ no-source");
    await send("POST", `/api/threads/${t.id}/messages`, JSON.stringify({ id: crypto.randomUUID(), content: "hello" }));
    const got = await fetch(`${BASE}/api/threads/${t.id}`).then((r) => r.json());
    expect(got.thread).not.toHaveProperty("source");
    expect(got.messages[0]).not.toHaveProperty("source");
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });
});

describe("search (LIKE wildcards in the query are literal)", () => {
  const find = async (q: string, sort?: string) =>
    (await fetch(`${BASE}/api/threads?q=${encodeURIComponent(q)}${sort ? `&sort=${sort}` : ""}`).then((r) =>
      r.json(),
    )) as { id: string; title: string }[];

  test("`%` and `_` match themselves, not everything", async () => {
    createThread("like-1", "100% done");
    createThread("like-2", "1000 done");
    expect((await find("100%")).map((t) => t.title)).toEqual(["100% done"]);
    expect((await find("_")).map((t) => t.title)).not.toContain("1000 done");
    expect(await find("%")).toHaveLength(1);
  });

  test("a thread is found by the text of one of its messages", async () => {
    createThread("like-3", "plain title");
    appendMessage({ id: crypto.randomUUID(), threadId: "like-3", role: "user", content: "the zebra crossed" });
    expect((await find("zebra")).map((t) => t.title)).toEqual(["plain title"]);
  });

  // FTS5's default `unicode61` tokenizer only matches whole tokens (0 hits for "izing" against
  // "resizing") — the `trigram` tokenizer was chosen specifically to keep this working like the old LIKE.
  test("a mid-word substring match still works (trigram, not the default whole-token tokenizer)", async () => {
    createThread("fts-mid-1", "Photo resizing notes");
    expect((await find("izing")).map((t) => t.title)).toEqual(["Photo resizing notes"]);
  });

  test("results come back ranked by relevance when there's a query: a title match outranks a content-only match", async () => {
    const contentOnly = createThread(crypto.randomUUID(), "grocery list");
    appendMessage({ id: crypto.randomUUID(), threadId: contentOnly.id, role: "user", content: "walnuts and dates" });
    const titleMatch = createThread(crypto.randomUUID(), "walnuts to buy");
    // `sort=title` would put these in the opposite order (alphabetically "grocery" < "walnuts") —
    // confirms bm25 ranking wins over `sort` whenever q is set.
    const rows = await find("walnuts", "title");
    expect(rows.map((r) => r.id)).toEqual([titleMatch.id, contentOnly.id]);
  });

  test("search after an edit or append picks up the new content (the FTS5 index actually stays in sync)", async () => {
    const t = createThread(crypto.randomUUID(), "sync check");
    expect(await find("kumquat")).toEqual([]);
    const { message } = appendMessage({
      id: crypto.randomUUID(),
      threadId: t.id,
      role: "user",
      content: "no fruit here",
    });
    expect(await find("kumquat")).toEqual([]);
    editMessage(message.id, [{ content: "a kumquat appeared", at: Date.now() }]);
    expect((await find("kumquat")).map((r) => r.id)).toEqual([t.id]);
    // The old text is gone from the index too, not just appended alongside the new text.
    expect(await find("no fruit here")).toEqual([]);
  });
});

// Simulates upgrading a real, already-populated threadz.sqlite made before `thread_search` existed:
// SCHEMA + backfillSearchIndex must be safe to re-run against it and must index what's already there.
describe("search index backfill (invariant: an existing database indexes fine after upgrading)", () => {
  test("threads/messages written before thread_search existed are searchable once the real init code re-runs", async () => {
    const { Database: RawDatabase } = await import("bun:sqlite");
    const raw = new RawDatabase(":memory:");
    // Only the columns an older version of this schema would have had — no thread_search yet.
    raw.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL);
    `);
    raw.query("INSERT INTO threads (id, title, created_at, updated_at) VALUES ('pre-1', 'Old thread', 1, 1)").run();
    raw
      .query(
        "INSERT INTO messages (id, thread_id, role, content, created_at, seq) VALUES ('pre-1-m1', 'pre-1', 'user', 'notes about resizing photos', 1, 1)",
      )
      .run();

    // The real startup sequence: create the table/triggers (idempotent), then backfill pre-existing rows.
    raw.exec(SCHEMA);
    backfillSearchIndex(raw);

    const hit = raw
      .query(
        "SELECT t.id FROM threads t JOIN thread_search ON thread_search.thread_id = t.id WHERE thread_search MATCH '\"izing\"'",
      )
      .all();
    expect(hit).toEqual([{ id: "pre-1" }]);

    // Idempotent: running it again (e.g. next boot) doesn't duplicate the row or error.
    raw.exec(SCHEMA);
    backfillSearchIndex(raw);
    expect(raw.query("SELECT COUNT(*) AS n FROM thread_search").get()).toEqual({ n: 1 });
    raw.close();
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

describe("POST /api/threads/:id/copy (invariant: A untouched, B is new ids on a client-minted thread id)", () => {
  const post = (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  test("copies up to N with new ids, keeps createdAt and an image reference, A stays as-is, a replay doesn't duplicate", async () => {
    const a = createThread("copy-a", "Original thread");
    const past = Date.now() - 100_000;
    const m1 = appendMessage({
      id: crypto.randomUUID(),
      threadId: a.id,
      role: "user",
      content: "first",
      createdAt: past,
    });
    const hash = "c".repeat(64);
    const m2 = appendMessage({
      id: crypto.randomUUID(),
      threadId: a.id,
      role: "user",
      content: `look ![](img:${hash}#4x3)`,
    });
    const m3 = appendMessage({ id: crypto.randomUUID(), threadId: a.id, role: "user", content: "after the cut" });

    const newThreadId = crypto.randomUUID();
    const res = await post(`/api/threads/${a.id}/copy`, { newThreadId, uptoMessageId: m2.message.id });
    expect(res.thread.title).toBe("Copy: Original thread");
    expect(res.thread.description).toBeNull();
    expect(res.thread.tags).toEqual([]);
    expect(res.messages.map((m: { content: string }) => m.content)).toEqual(["first", `look ![](img:${hash}#4x3)`]);
    expect(res.messages[0].createdAt).toBe(past);
    const copiedIds = res.messages.map((m: { id: string }) => m.id);
    expect(copiedIds).not.toContain(m1.message.id);
    expect(copiedIds).not.toContain(m2.message.id);

    // A is untouched: still all three messages, with their original ids.
    const stillA = await fetch(`${BASE}/api/threads/${a.id}`).then((r) => r.json());
    expect(stillA.messages.map((m: { id: string }) => m.id)).toEqual([m1.message.id, m2.message.id, m3.message.id]);

    // A replay with the same client-minted newThreadId is a no-op, not a duplicate.
    const replay = await post(`/api/threads/${a.id}/copy`, { newThreadId, uptoMessageId: m2.message.id });
    expect(replay.messages).toHaveLength(2);
    const afterReplay = await fetch(`${BASE}/api/threads/${newThreadId}`).then((r) => r.json());
    expect(afterReplay.messages).toHaveLength(2);

    await fetch(`${BASE}/api/threads/${a.id}`, { method: "DELETE" });
    await fetch(`${BASE}/api/threads/${newThreadId}`, { method: "DELETE" });
  });

  test("appends the composer's note as B's next message, in the same call", async () => {
    const a = createThread("copy-note", "Source");
    const m1 = appendMessage({ id: crypto.randomUUID(), threadId: a.id, role: "user", content: "only message" });
    const newThreadId = crypto.randomUUID();
    const res = await post(`/api/threads/${a.id}/copy`, {
      newThreadId,
      uptoMessageId: m1.message.id,
      appendNote: { id: `note-${newThreadId}`, content: "typed while copying" },
    });
    expect(res.messages.map((m: { content: string }) => m.content)).toEqual(["only message", "typed while copying"]);
    await fetch(`${BASE}/api/threads/${a.id}`, { method: "DELETE" });
    await fetch(`${BASE}/api/threads/${newThreadId}`, { method: "DELETE" });
  });

  test("404s on an unknown source thread or a message that isn't in it", async () => {
    const a = createThread("copy-404", "T");
    expect((await fetch(`${BASE}/api/threads/ghost/copy`, { method: "POST" })).status).toBe(404);
    const bad = await fetch(`${BASE}/api/threads/${a.id}/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newThreadId: crypto.randomUUID(), uptoMessageId: "not-a-message" }),
    });
    expect(bad.status).toBe(404);
    await fetch(`${BASE}/api/threads/${a.id}`, { method: "DELETE" });
  });
});

describe("annotations (invariant: own row, same fields as a message minus role, hash only grows when non-empty)", () => {
  const post = (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const patch = (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  test("idempotent create (client id), edit keeps history, exactly like a message", async () => {
    const t = createThread(crypto.randomUUID(), "annotate-me");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "base" });
    const aid = crypto.randomUUID();

    const a = await post(`/api/threads/${t.id}/messages/${message.id}/annotations`, { id: aid, content: "first note" });
    expect(a.inserted).toBe(true);
    expect(a.annotation).toMatchObject({ id: aid, threadId: t.id, messageId: message.id, content: "first note" });

    const replay = await post(`/api/threads/${t.id}/messages/${message.id}/annotations`, {
      id: aid,
      content: "ignored on replay",
    });
    expect(replay.inserted).toBe(false);
    expect(replay.annotation.content).toBe("first note"); // create never overwrites

    await new Promise((r) => setTimeout(r, 5)); // distinct `at` from the creation instant
    const edited = await patch(`/api/threads/${t.id}/annotations/${aid}`, { content: "revised note" });
    expect(edited.annotation.content).toBe("revised note");
    expect(edited.annotation.edits.map((v: { content: string }) => v.content)).toEqual(["first note"]);
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("404s when the message isn't in the thread, or the annotation isn't in it", async () => {
    const t = createThread(crypto.randomUUID(), "annotate-404");
    const other = createThread(crypto.randomUUID(), "annotate-404-other");
    const bad = await fetch(`${BASE}/api/threads/${t.id}/messages/not-a-message/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), content: "x" }),
    });
    expect(bad.status).toBe(404);
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: other.id, role: "user", content: "m" });
    const a = await post(`/api/threads/${other.id}/messages/${message.id}/annotations`, {
      id: crypto.randomUUID(),
      content: "note",
    });
    // right annotation, wrong thread in the URL
    const wrongThread = await fetch(`${BASE}/api/threads/${t.id}/annotations/${a.annotation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "y" }),
    });
    expect(wrongThread.status).toBe(404);
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
    await fetch(`${BASE}/api/threads/${other.id}`, { method: "DELETE" });
  });

  test("threadHash is byte-for-byte the pre-annotation formula when a thread has none, and changes once one is added", () => {
    const t = createThread(crypto.randomUUID(), "hash-thread");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "m" });
    const withoutAnnotations = new Bun.CryptoHasher("sha1").update(`${t.id}\n${t.title}\n${message.id}`).digest("hex");
    const before = threadHash(getThread(t.id)!);
    expect(before).toBe(withoutAnnotations); // exactly the old formula: zero annotations changes nothing

    const aid = crypto.randomUUID();
    appendAnnotation({ id: aid, threadId: t.id, messageId: message.id, content: "note" });
    const after = threadHash(getThread(t.id)!);
    expect(after).not.toBe(before);
    expect(after).toBe(new Bun.CryptoHasher("sha1").update(`${t.id}\n${t.title}\n${message.id}\n${aid}`).digest("hex"));
    db.query("DELETE FROM threads WHERE id = ?").run(t.id);
  });

  test("sync: an annotation reaches main, a replay doesn't duplicate, and one whose message's thread is gone is reported missing, not dropped", async () => {
    const sync = (body: unknown) =>
      fetch(`${BASE}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const t = createThread(crypto.randomUUID(), "sync-annotate");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "m" });
    const aid = crypto.randomUUID();
    const payload = {
      threads: [],
      messages: [],
      annotations: [{ id: aid, threadId: t.id, messageId: message.id, content: "offline annotation" }],
      deletes: [],
    };
    const a = await sync(payload);
    expect(a.appended).toBe(1);
    const b = await sync(payload);
    expect(b.appended).toBe(0); // replay: idempotent
    expect(getAnnotations(t.id).map((x) => x.content)).toEqual(["offline annotation"]);

    const ghost = crypto.randomUUID();
    const r = await sync({
      threads: [],
      messages: [],
      annotations: [{ id: crypto.randomUUID(), threadId: ghost, messageId: crypto.randomUUID(), content: "orphan" }],
      deletes: [],
    });
    expect(r.missing).toEqual([ghost]);
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("copy: annotations on a copied message are copied with messageId remapped; a message with none doesn't error", async () => {
    const a = createThread(crypto.randomUUID(), "copy-source-with-annotations");
    const m1 = appendMessage({ id: crypto.randomUUID(), threadId: a.id, role: "user", content: "first" });
    const m2 = appendMessage({ id: crypto.randomUUID(), threadId: a.id, role: "user", content: "second" });
    const anno = appendAnnotation({
      id: crypto.randomUUID(),
      threadId: a.id,
      messageId: m1.message.id,
      content: "note on first",
    });

    const newThreadId = crypto.randomUUID();
    const result = copyThread(newThreadId, a.id, m2.message.id)!;
    expect(result.annotations).toHaveLength(1);
    const copiedMessageId = result.messages.find((m) => m.content === "first")!.id;
    expect(result.annotations[0]?.message_id).toBe(copiedMessageId);
    expect(result.annotations[0]?.content).toBe("note on first");
    expect(result.annotations[0]?.id).not.toBe(anno.annotation.id);

    // A replay is idempotent (same annotation ids re-derived, not duplicated).
    const replay = copyThread(newThreadId, a.id, m2.message.id)!;
    expect(replay.annotations).toHaveLength(1);

    db.query("DELETE FROM threads WHERE id = ?").run(a.id);
    db.query("DELETE FROM threads WHERE id = ?").run(newThreadId);
  });

  test("images: a photo referenced only from an annotation is never garbage-collected as an orphan", async () => {
    const t = createThread(crypto.randomUUID(), "annotation-image");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "plain" });
    const hash = "e".repeat(64);
    appendAnnotation({
      id: crypto.randomUUID(),
      threadId: t.id,
      messageId: message.id,
      content: `![](img:${hash}#4x3)`,
    });
    const { existsSync: exists, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(IMAGES_DIR, { recursive: true });
    writeFileSync(join(IMAGES_DIR, hash), Buffer.from([1, 2, 3]));
    const later = Date.now() + 8 * 24 * 3600 * 1000;
    collectOrphanImages(later);
    expect(exists(join(IMAGES_DIR, hash))).toBe(true); // still referenced, from the annotation
    db.query("DELETE FROM threads WHERE id = ?").run(t.id);
  });

  test("one annotation per message: a second create for the same message folds into an edit, not a second row", async () => {
    const t = createThread(crypto.randomUUID(), "one-per-message");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "base" });
    const first = await post(`/api/threads/${t.id}/messages/${message.id}/annotations`, {
      id: crypto.randomUUID(),
      content: "first note",
    });
    expect(first.inserted).toBe(true);

    await new Promise((r) => setTimeout(r, 5)); // distinct `at` from the first create
    // A different client id, as if a second offline device independently annotated the same message.
    const second = await post(`/api/threads/${t.id}/messages/${message.id}/annotations`, {
      id: crypto.randomUUID(),
      content: "second note",
    });
    expect(second.inserted).toBe(false); // folded onto the row that won the race, not a new one
    expect(second.annotation.id).toBe(first.annotation.id);
    expect(second.annotation.content).toBe("second note");
    expect(second.annotation.edits.map((v: { content: string }) => v.content)).toEqual(["first note"]);
    expect(getAnnotationsForMessage(message.id)).toHaveLength(1); // still exactly one row
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("DELETE removes an annotation for good; 404s for an unknown id or one addressed via a different thread", async () => {
    const t = createThread(crypto.randomUUID(), "delete-live");
    const other = createThread(crypto.randomUUID(), "delete-live-other");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "base" });
    const created = await post(`/api/threads/${t.id}/messages/${message.id}/annotations`, {
      id: crypto.randomUUID(),
      content: "gone soon",
    });
    const del = (path: string) => fetch(`${BASE}${path}`, { method: "DELETE" });

    // Right annotation, wrong thread in the URL: 404, and the row must survive untouched.
    const wrongThread = await del(`/api/threads/${other.id}/annotations/${created.annotation.id}`);
    expect(wrongThread.status).toBe(404);
    expect(getAnnotation(created.annotation.id)).toBeTruthy();

    expect((await del(`/api/threads/${t.id}/annotations/${crypto.randomUUID()}`)).status).toBe(404);

    const ok = await del(`/api/threads/${t.id}/annotations/${created.annotation.id}`);
    expect(ok.status).toBe(200);
    expect(getAnnotation(created.annotation.id)).toBeFalsy();
    expect((await del(`/api/threads/${t.id}/annotations/${created.annotation.id}`)).status).toBe(404); // already gone

    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
    await fetch(`${BASE}/api/threads/${other.id}`, { method: "DELETE" });
  });

  test("sync annotationDeletes: a matching baseVersion deletes; a stale one is refused and the newer content survives", async () => {
    const sync = (body: unknown) =>
      fetch(`${BASE}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const t = createThread(crypto.randomUUID(), "sync-annotation-delete");
    const { message } = appendMessage({ id: crypto.randomUUID(), threadId: t.id, role: "user", content: "base" });
    const aid = crypto.randomUUID();
    const created = appendAnnotation({ id: aid, threadId: t.id, messageId: message.id, content: "will be deleted" });
    const staleBaseVersion = created.annotation.created_at; // never edited yet, so createdAt is its version

    await new Promise((r) => setTimeout(r, 5));
    editAnnotation(aid, [{ content: "edited on main first", at: Date.now() }]);

    const stale = await sync({
      threads: [],
      messages: [],
      annotations: [],
      deletes: [],
      annotationDeletes: [{ id: aid, baseVersion: staleBaseVersion }],
    });
    expect(stale.kept).toEqual([aid]); // content wins: the edit is newer than what the device last saw
    expect(getAnnotation(aid)?.content).toBe("edited on main first");

    const current = getAnnotation(aid)!;
    const ok = await sync({
      threads: [],
      messages: [],
      annotations: [],
      deletes: [],
      annotationDeletes: [{ id: aid, baseVersion: current.edited_at! }],
    });
    expect(ok.deleted).toEqual([aid]);
    expect(getAnnotation(aid)).toBeFalsy();

    // A replay (or a delete for a row that's already gone) is idempotent, not an error.
    const replay = await sync({
      threads: [],
      messages: [],
      annotations: [],
      deletes: [],
      annotationDeletes: [{ id: aid, baseVersion: 0 }],
    });
    expect(replay.deleted).toEqual([aid]);
    await fetch(`${BASE}/api/threads/${t.id}`, { method: "DELETE" });
  });

  test("startup dedupe: keeps only the most recently edited annotation per message, so the unique index can then be created", async () => {
    // A pre-existing violation can only be reproduced on a table that doesn't have the unique index yet —
    // this server's own db already does — so this exercises the real dedupe function against a throwaway file.
    const { Database: RawDatabase } = await import("bun:sqlite");
    const raw = new RawDatabase(":memory:");
    raw.exec(`CREATE TABLE annotations (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, content TEXT NOT NULL,
      created_at INTEGER NOT NULL, edited_at INTEGER, edits TEXT
    )`);
    const mid = "shared-message";
    raw
      .query(
        "INSERT INTO annotations (id, thread_id, message_id, content, created_at, edited_at) VALUES ('older', 't', ?, 'older, never edited', 100, NULL)",
      )
      .run(mid);
    raw
      .query(
        "INSERT INTO annotations (id, thread_id, message_id, content, created_at, edited_at) VALUES ('newer-edited', 't', ?, 'edited later', 50, 200)",
      )
      .run(mid);
    raw
      .query(
        "INSERT INTO annotations (id, thread_id, message_id, content, created_at) VALUES ('unrelated', 't', 'other-message', 'unrelated', 1)",
      )
      .run();

    dedupeDuplicateAnnotations(raw);
    expect(() => raw.exec("CREATE UNIQUE INDEX idx_test_one_per_message ON annotations(message_id)")).not.toThrow();
    expect(raw.query("SELECT id FROM annotations WHERE message_id = ?").all(mid)).toEqual([{ id: "newer-edited" }]);
    expect(raw.query("SELECT id FROM annotations").all()).toHaveLength(2); // the unrelated row is untouched
    raw.close();
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

  let local: typeof import("../frontend/src/lib/local");
  let handoff: typeof import("../frontend/src/lib/handoff");
  let remote: typeof import("../frontend/src/lib/api");
  let modeLib: typeof import("../frontend/src/lib/mode");
  let images: typeof import("../frontend/src/lib/images");
  beforeAll(async () => {
    process.env.VITE_BACKEND_URL = BASE; // read when frontend/src/lib/config is first imported
    images = await import("../frontend/src/lib/images");
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

  test("copyThread (local): new ids, createdAt/images kept, A untouched, a replay doesn't duplicate, and it syncs offline", async () => {
    const a = await local.localApi.createThread({ title: "__local__ copy source" });
    const past = Date.now() - 50_000;
    const m1 = await local.localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "first", createdAt: past });
    const hash = "d".repeat(64);
    const m2 = await local.localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: `![](img:${hash}#4x3)` });
    await local.localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "after the cut" });

    const newThreadId = crypto.randomUUID();
    const copy = await local.localApi.copyThread(a.id, { newThreadId, uptoMessageId: m2.message.id });
    expect(copy.thread.title).toBe("Copy: __local__ copy source");
    expect(copy.thread.description).toBeNull();
    expect(copy.messages.map((m) => m.content)).toEqual(["first", `![](img:${hash}#4x3)`]);
    expect(copy.messages[0]?.createdAt).toBe(past);
    const copiedIds = copy.messages.map((m) => m.id);
    expect(copiedIds).not.toContain(m1.message.id);
    expect(copiedIds).not.toContain(m2.message.id);

    // A is untouched on the device.
    expect(await localContents(a.id)).toEqual(["first", `![](img:${hash}#4x3)`, "after the cut"]);

    // A replay with the same client-minted id is a no-op.
    const replay = await local.localApi.copyThread(a.id, { newThreadId, uptoMessageId: m2.message.id });
    expect(replay.messages).toHaveLength(2);

    // Made entirely offline, B syncs to main like any other thread.
    await handoff.syncNow();
    expect((await contents(newThreadId)).sort()).toEqual(["first", `![](img:${hash}#4x3)`].sort());
    await cleanUp(a.id, newThreadId);
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
    expect(await local.countUnsynced()).toEqual({ threads: 0, messages: 0, annotations: 0, deletions: 0 });
    expect(await localContents(t.id)).toHaveLength(2);
    // in sync = our base hashes are exactly main's
    expect(await local.getBase()).toEqual((await fetch(`${BASE}/api/head`).then((r) => r.json())).threads);
    await cleanUp(t.id);
  });

  test("a photo taken offline reaches main before its note, is then clean on the device, and a replay sends nothing", async () => {
    const bytes = Uint8Array.from({ length: 3000 }, (_, i) => [0xff, 0xd8, 0xff][i] ?? (i * 13) % 253);
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const t = await local.localApi.createThread({ title: "__local__ photo", seed: `![](img:${hash}#40x30)` });
    await images.putImage(hash, new Blob([bytes], { type: "image/jpeg" }), 1);
    expect((await fetch(`${BASE}/api/images/${hash}`)).status).toBe(404);

    await handoff.syncNow();
    const got = await fetch(`${BASE}/api/images/${hash}`);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect(await images.dirtyImages()).toEqual([]);
    expect(await images.getImage(hash)).toBeDefined(); // still on the device
    expect(await contents(t.id)).toEqual([`![](img:${hash}#40x30)`]);
    await handoff.syncNow(); // idempotent
    await cleanUp(t.id);
  });

  test("device GC drops clean cached images nothing refers to; dirty, referenced (incl. trashed) and fresh ones stay", async () => {
    const blob = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 1)], { type: "image/jpeg" });
    const h = (c: string) => c.repeat(64);
    const t = await local.localApi.createThread({ title: "__local__ gc", seed: `![](img:${h("1")}#4x3)` });
    const gone = await local.localApi.createThread({ title: "__local__ gc trash", seed: `![](img:${h("2")}#4x3)` });
    await local.localApi.deleteThread(gone.id); // its note now sits in trash: still a reference
    for (const c of "12345") await images.putImage(h(c), blob, c === "4" ? 1 : 0);
    // 1, 2 referenced; 3, 5 orphans (clean); 4 orphan but dirty (own hashes: the store is shared with images.test.ts)
    expect(await images.gcDeviceImages()).not.toContain(h("3")); // cached just now: grace period
    const later = Date.now() + 2 * 24 * 3600 * 1000;
    const removed = await images.gcDeviceImages(later);
    expect(removed).toContain(h("3"));
    expect(removed).toContain(h("5"));
    expect(removed).not.toContain(h("1"));
    expect(removed).not.toContain(h("2"));
    expect(removed).not.toContain(h("4"));
    expect(await images.getImage(h("1"))).toBeDefined();
    expect(await images.getImage(h("2"))).toBeDefined();
    expect(await images.getImage(h("4"))).toBeDefined(); // dirty: never
    expect(await images.getImage(h("3"))).toBeUndefined();
    await images.markImageClean(h("4")); // a stand-in, not a real photo: don't let later syncs try to PUT it
    await cleanUp(t.id, gone.id);
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

  test("an annotation created offline reaches main, and a replay doesn't duplicate it", async () => {
    const t = await local.localApi.createThread({ title: "__local__ annotate", seed: "base note" });
    await handoff.syncNow();
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    const a = await local.localApi.appendAnnotation(t.id, m.id, { id: crypto.randomUUID(), content: "my annotation" });
    expect(a.inserted).toBe(true);
    expect((await local.countUnsynced()).annotations).toBe(1);

    const first = await handoff.syncNow();
    const second = await handoff.syncNow();
    expect(first.pushed).toBeGreaterThan(0);
    expect(second.pushed).toBe(0);

    const main = await mainGet(t.id).then((r) => r.json());
    expect(main.annotations.map((x: { content: string }) => x.content)).toEqual(["my annotation"]);
    expect((await local.countUnsynced()).annotations).toBe(0);
    await cleanUp(t.id);
  });

  test("an annotation deleted offline is gone locally at once (no tombstone) and the delete reaches main on the next sync", async () => {
    const t = await local.localApi.createThread({ title: "__local__ delete-annotation", seed: "base note" });
    await handoff.syncNow();
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    const a = await local.localApi.appendAnnotation(t.id, m.id, {
      id: crypto.randomUUID(),
      content: "will be deleted",
    });
    await handoff.syncNow(); // both sides agree on it first

    await local.localApi.deleteAnnotation(t.id, a.annotation.id);
    expect((await local.localApi.getThread(t.id)).annotations).toEqual([]); // gone here right away
    expect((await local.countUnsynced()).deletions).toBeGreaterThan(0);

    await handoff.syncNow();
    const second = await handoff.syncNow(); // replay: nothing left to send
    expect(second.pushed).toBe(0);
    const main = await mainGet(t.id).then((r) => r.json());
    expect(main.annotations).toEqual([]);
    expect(await local.countUnsynced()).toEqual({ threads: 0, messages: 0, annotations: 0, deletions: 0 });
    await cleanUp(t.id);
  });

  test("annotation delete vs. main's edit: refused (content wins), and the device ends up with main's newer text, not stuck pending forever", async () => {
    const t = await local.localApi.createThread({ title: "__local__ delete-vs-edit-annotation", seed: "base note" });
    await handoff.syncNow();
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    const a = await local.localApi.appendAnnotation(t.id, m.id, { id: crypto.randomUUID(), content: "original" });
    await handoff.syncNow(); // both sides agree on "original"

    await local.localApi.deleteAnnotation(t.id, a.annotation.id); // queued locally; main not told yet
    await new Promise((r) => setTimeout(r, 5));
    await fetch(`${BASE}/api/threads/${t.id}/annotations/${a.annotation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "edited on main first" }),
    });

    await handoff.syncNow();
    const survivor = await local.localApi.getThread(t.id);
    expect(survivor.annotations.map((x) => x.content)).toEqual(["edited on main first"]); // brought back, not deleted
    const main = await mainGet(t.id).then((r) => r.json());
    expect(main.annotations.map((x: { content: string }) => x.content)).toEqual(["edited on main first"]);
    expect(await local.countUnsynced()).toEqual({ threads: 0, messages: 0, annotations: 0, deletions: 0 }); // not stuck
    await cleanUp(t.id);
  });

  test("applyRemoteDelete: main deletes a thread whose only unsynced change is a dirty annotation on an otherwise-clean message — the thread is KEPT, not destroyed", async () => {
    const t = await local.localApi.createThread({ title: "__local__ dirty-annotation-keep", seed: "clean message" });
    await handoff.syncNow(); // thread + message are clean on both sides
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    // An unsynced annotation on that otherwise-clean message — nothing else about the thread is dirty.
    await local.localApi.appendAnnotation(t.id, m.id, { id: crypto.randomUUID(), content: "not yet on main" });
    await mainDelete(t.id); // main deletes it without ever seeing the annotation

    const outcome = await local.applyRemoteDelete(t.id);
    expect(outcome).toBe("kept"); // this is the bug the backlog named: it must NOT be "removed"
    const survivor = await local.localApi.getThread(t.id);
    expect(survivor.thread.id).toBe(t.id);

    // Syncing re-creates the thread on main with the annotation intact.
    const r = await handoff.syncNow();
    expect(r.pushed).toBeGreaterThan(0);
    const main = await mainGet(t.id).then((res) => res.json());
    expect(main.annotations.map((x: { content: string }) => x.content)).toEqual(["not yet on main"]);
    await cleanUp(t.id);
  });

  test("copying a message with annotations copies them too (messageId remapped); one with none doesn't error", async () => {
    const a = await local.localApi.createThread({ title: "__local__ copy-annotations" });
    const m1 = await local.localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "first" });
    const m2 = await local.localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "second, no annotations" });
    await local.localApi.appendAnnotation(a.id, m1.message.id, {
      id: crypto.randomUUID(),
      content: "note on first",
    });

    const newThreadId = crypto.randomUUID();
    const copy = await local.localApi.copyThread(a.id, { newThreadId, uptoMessageId: m2.message.id });
    expect(copy.annotations).toHaveLength(1);
    const copiedFirst = copy.messages.find((m) => m.content === "first")!;
    expect(copy.annotations[0]?.messageId).toBe(copiedFirst.id);
    expect(copy.annotations[0]?.content).toBe("note on first");
    await cleanUp(a.id, newThreadId);
  });

  test("device GC: an image referenced only from an annotation is never collected as an orphan", async () => {
    const blob = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 9)], { type: "image/jpeg" });
    const hash = "f".repeat(64);
    const t = await local.localApi.createThread({ title: "__local__ annotation-image" });
    const m = await local.localApi.appendMessage(t.id, { id: crypto.randomUUID(), content: "plain message" });
    await local.localApi.appendAnnotation(t.id, m.message.id, {
      id: crypto.randomUUID(),
      content: `![](img:${hash}#4x3)`,
    });
    await images.putImage(hash, blob, 0); // a clean cached copy, old enough to be swept if unreferenced
    const later = Date.now() + 2 * 24 * 3600 * 1000;
    const removed = await images.gcDeviceImages(later);
    expect(removed).not.toContain(hash);
    expect(await images.getImage(hash)).toBeDefined();
    await cleanUp(t.id);
  });

  test("importing a backup without an `annotations` field (an old export) still imports cleanly", async () => {
    const t = { ...(await local.localApi.createThread({ title: "__local__ old-backup-shape" })) };
    await local.localApi.deleteThread(t.id); // clears it locally so the import below actually restores it
    const oldShapeSnapshot = {
      version: 1 as const,
      exportedAt: Date.now(),
      threads: [t],
      messages: [],
      // deliberately no `annotations` field, like a backup made before this feature existed
    };
    const added = await local.mergeSnapshot(oldShapeSnapshot);
    expect(added.threads).toBe(1);
    expect((await local.localApi.getThread(t.id)).thread.id).toBe(t.id);
    await cleanUp(t.id);
  });

  const mainPatch = (path: string, body: unknown) =>
    fetch(`${BASE}/api/threads/${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const mainMessages = async (id: string) => (await mainGet(id).then((r) => r.json())).messages;

  test("an edit and a rename made offline reach main; previous text is kept", async () => {
    const t = await local.localApi.createThread({ title: "__local__ edit", seed: "first draft" });
    await handoff.syncNow();
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    await local.localApi.editMessage(t.id, m.id, "second draft");
    await local.localApi.renameThread(t.id, "__local__ renamed");

    await handoff.syncNow();
    const main = await mainGet(t.id).then((r) => r.json());
    expect(main.thread.title).toBe("__local__ renamed");
    expect(main.messages[0]?.content).toBe("second draft");
    expect(main.messages[0].edits.map((v: { content: string }) => v.content)).toEqual(["first draft"]);
    expect((await local.localApi.getThread(t.id)).messages[0]?.edits).toHaveLength(1);
    await cleanUp(t.id);
  });

  test("the same note edited on main and on the device: newest text wins, the other stays in history", async () => {
    const t = await local.localApi.createThread({ title: "__local__ both-edit", seed: "base" });
    await handoff.syncNow();
    const m = (await local.localApi.getThread(t.id)).messages[0]!;
    await mainPatch(`${t.id}/messages/${m.id}`, { content: "main edit" });
    await new Promise((r) => setTimeout(r, 5));
    await local.localApi.editMessage(t.id, m.id, "device edit");

    await handoff.syncNow();
    for (const msgs of [(await mainMessages(t.id)) as never[], (await local.localApi.getThread(t.id)).messages]) {
      const x = msgs[0] as { content: string; edits: { content: string }[] };
      expect(x.content).toBe("device edit");
      expect(x.edits.map((v) => v.content)).toEqual(["base", "main edit"]);
    }
    await cleanUp(t.id);
  });

  test("a newer rename on main is not clobbered by an older one from the device", async () => {
    const t = await local.localApi.createThread({ title: "__local__ rename-race" });
    await handoff.syncNow();
    await local.localApi.renameThread(t.id, "device name");
    await new Promise((r) => setTimeout(r, 5));
    await mainPatch(t.id, { title: "main name" });

    await handoff.syncNow();
    expect((await mainGet(t.id).then((r) => r.json())).thread.title).toBe("main name");
    expect((await local.localApi.getThread(t.id)).thread.title).toBe("main name");
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
    const wrongTypes = {
      version: 1,
      threads: [{ id: "x", title: 5, createdAt: 1, updatedAt: 1, tags: [] }],
      messages: [],
    };
    await expect(handoff.importBackup(new File([JSON.stringify(wrongTypes)], "x.json"))).rejects.toThrow(
      "Not a Threadz backup",
    );
    await expect(handoff.importBackup(new File(["not json"], "x.json"))).rejects.toThrow("Not a Threadz backup");
    expect((await local.exportSnapshot()).threads).toHaveLength(before.threads.length);
  });

  // Replace global fetch for one test; always put it back.
  const withFetch = async (fake: typeof fetch, fn: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = fake;
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
  };
  const lostReply = (urlPart: string): typeof fetch =>
    (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/health")) throw new TypeError("Failed to fetch"); // and the probe fails too: really offline
      const res = await fetch_(input, init);
      if (url.includes(urlPart) && init?.method === "POST") throw new TypeError("Failed to fetch"); // main got it, the reply died
      return res;
    }) as typeof fetch;
  const fetch_ = globalThis.fetch;

  test("GETs carry no content-type (no CORS preflight); an error body of JSON null is still an ApiError", async () => {
    const seen: (string | null)[] = [];
    await withFetch(
      (async (_url, init) => {
        seen.push(new Headers(init?.headers).get("content-type"));
        return new Response("null", { status: 500, statusText: "Boom" });
      }) as typeof fetch,
      async () => {
        await expect(remote.remoteApi.listThreads()).rejects.toMatchObject({ status: 500, message: "500 Boom" });
        await expect(remote.remoteApi.createThread({ title: "x" })).rejects.toMatchObject({ status: 500 });
      },
    );
    expect(seen).toEqual([null, "application/json"]);
  });

  test("a create whose reply is lost after main stored it does not double the seed note on retry", async () => {
    modeLib.setMode("live");
    let id = "";
    await withFetch(lostReply("/messages"), async () => {
      id = (await remote.api.createThread({ title: "__local__ seed-dedupe", seed: "only once" })).id;
    });
    expect(modeLib.getMode()).toBe("local"); // detached, retried on the device
    await handoff.goLive();
    expect(await contents(id)).toEqual(["only once"]);
    await cleanUp(id);
  });

  test("detach() when already local leaves no stale 'main went away' flag for the next goLive", () => {
    modeLib.setMode("local");
    modeLib.detach();
    expect(modeLib.takeDetached()).toBe(false);
    modeLib.setMode("live");
    modeLib.detach();
    expect(modeLib.takeDetached()).toBe(true);
    modeLib.setMode("live");
  });

  test("one failed probe never detaches a live app; two in a row do", async () => {
    const status = await import("../frontend/src/lib/status");
    modeLib.setMode("live");
    expect(modeLib.replicaReady()).toBe(true);
    await withFetch(
      (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      async () => {
        await status.probe();
        expect(modeLib.getMode()).toBe("live");
        await status.probe();
        expect(modeLib.getMode()).toBe("local");
      },
    );
    modeLib.setMode("live");
  });

  test("a photo main permanently refuses is skipped and reported, stays dirty, and does not stop the sync", async () => {
    const junk = Uint8Array.from({ length: 200 }, (_, i) => i); // not a JPEG: main answers 4xx
    const hash = new Bun.CryptoHasher("sha256").update(junk).digest("hex");
    await images.putImage(hash, new Blob([junk], { type: "image/jpeg" }), 1);
    const t = await local.localApi.createThread({ title: "__local__ bad photo", seed: `![](img:${hash}#5x5)` });

    const report = await handoff.syncNow();
    expect(report.skippedImages).toBe(1);
    expect((await images.dirtyImages()).map((r) => r.hash)).toEqual([hash]); // never deleted, never marked clean
    expect(await contents(t.id)).toEqual([`![](img:${hash}#5x5)`]); // the note still went
    await images.markImageClean(hash); // keep the shared store tidy for other tests
    await cleanUp(t.id);
  });

  test("bytes from main are cached only when they hash to the name asked for", async () => {
    const sync = await import("../frontend/src/lib/imageSync");
    const good = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    const goodHash = new Bun.CryptoHasher("sha256").update(good).digest("hex");
    const badHash = "b".repeat(64); // main "answers" with bytes that are not this file
    const answer = (bytes: Uint8Array) => (async () => new Response(bytes)) as unknown as typeof fetch;
    modeLib.setMode("live");
    URL.createObjectURL ??= () => "blob:test";

    await withFetch(answer(good), async () => {
      expect(await sync.resolveImage(badHash)).toBeNull();
      expect(await images.getImage(badHash)).toBeUndefined();
      expect(await sync.resolveImage(goodHash)).not.toBeNull();
      expect(await images.getImage(goodHash)).toBeDefined();
    });
  });
});

describe("version merge parity", () => {
  test("frontend and backend mergeVersions agree (they must, or devices and main never converge)", async () => {
    const { mergeVersions: back } = await import("../backend/db.ts");
    const { mergeVersions: front } = await import("../frontend/src/lib/versions.ts");
    const a = [
      { content: "a", at: 1 },
      { content: "c", at: 3 },
    ];
    const b = [
      { content: "b", at: 2 },
      { content: "c2", at: 3 },
    ];
    expect(front(a, b)).toEqual(back(a, b));
  });
});

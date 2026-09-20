import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// Isolated DB + stubbed model seam BEFORE importing anything that touches them.
// Only the model seam is mocked — real db + real metadata logic run against it.
const DB_PATH = `/tmp/threadz-test-${crypto.randomUUID()}.sqlite`;
process.env.THREADZ_DB = DB_PATH;

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

import type { BunRequest } from "bun";
import type { z } from "zod";
import {
  allMessages,
  appendMessage,
  applySync,
  backupDb,
  createThread,
  deleteThread,
  editMessage,
  getMessages,
  getThread,
  heads,
  listThreads,
  messageJson,
  renameThread,
  threadEmbeddings,
  threadHash,
  threadJson,
} from "./db";
import { collectOrphanImages, imageFile, saveImage } from "./images";
import { generateMetadata, metadataEnabled, refreshMetadata } from "./metadata";
import { askModel, type ChatMessage, CLAUDE_MODEL, embed, HttpError } from "./model";
import { AppendMessage, AskThread, CreateThread, EditMessage, RenameThread, SyncPayload } from "./schemas";

const PORT = Number(process.env.PORT || 8787);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

const wrap =
  <Path extends string>(
    fn: (req: BunRequest<Path>, params: BunRequest<Path>["params"]) => Promise<Response> | Response,
  ) =>
  async (req: BunRequest<Path>) => {
    try {
      return await fn(req, req.params);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("[threadz]", err);
      return json({ error: String(err) }, 500);
    }
  };

// Parse + validate a JSON body; a bad body is the caller's fault (400), never a 500.
const readBody = async <S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.map(String).join(".");
  throw new HttpError(400, path ? `${path}: ${issue?.message}` : (issue?.message ?? "invalid body"));
};

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

const requireThread = (id: string) => {
  const t = getThread(id);
  if (!t) throw new HttpError(404, "thread not found");
  return t;
};

// Desktop launcher (Threadz.app): every open tab holds this stream; when the last one drops, exit.
const QUIT_ON_CLOSE = !!process.env.THREADZ_QUIT_ON_CLOSE;
const PING = new TextEncoder().encode(": \n\n");
let tabs = 0;
let quitTimer: ReturnType<typeof setTimeout> | undefined;
if (QUIT_ON_CLOSE) setTimeout(() => tabs || process.exit(0), 60_000); // browser never showed up
const presence = () => {
  tabs++;
  clearTimeout(quitTimer);
  let ping: ReturnType<typeof setInterval>;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(PING);
      ping = setInterval(() => c.enqueue(PING), 5000); // keeps Bun's 10s idle timeout away
    },
    cancel() {
      clearInterval(ping);
      // 3s grace so a page reload doesn't kill the app
      if (--tabs === 0 && QUIT_ON_CLOSE) quitTimer = setTimeout(() => process.exit(0), 3000);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...CORS } });
};

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0", // reachable from the phone over the LAN
  routes: {
    "/api/health": () => json({ ok: true, model: CLAUDE_MODEL }),
    "/api/presence": presence,

    // Whole store in one consistent read: a device going local copies this, and verifies against it.
    // Text only — images are fetched one by one from /api/images/:hash.
    "/api/snapshot": () =>
      json({
        version: 1,
        exportedAt: Date.now(),
        threads: listThreads().map(threadJson),
        messages: allMessages().map(messageJson),
      }),

    // Cheap "did main move?" check: one hash per thread + one for the whole store.
    "/api/head": () => json(heads()),

    // A device's offline work, applied atomically after a backup of main.
    "/api/sync": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (req) => {
        const payload = await readBody(req, SyncPayload);
        if (payload.threads.length + payload.messages.length + payload.deletes.length > 0) backupDb();
        const { touched, ...result } = applySync(payload);
        for (const id of touched) refreshMetadata(id);
        return json({ ...result, ...heads() });
      }),
    },

    // Immutable, content-addressed JPEGs. PUT is idempotent and re-hashes the body.
    "/api/images/:hash": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      GET: wrap((_req, p) => {
        const file = imageFile(p.hash);
        if (!file) throw new HttpError(404, "image not found");
        return new Response(file, {
          headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable", ...CORS },
        });
      }),
      PUT: wrap(async (req, p) =>
        json({ ok: true, stored: await saveImage(p.hash, new Uint8Array(await req.arrayBuffer())) }),
      ),
    },

    "/api/threads": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      GET: wrap((req) => {
        const url = new URL(req.url);
        const rows = listThreads(url.searchParams.get("q") || undefined, url.searchParams.get("sort") || "updated");
        return json(rows.map(threadJson));
      }),
      POST: wrap(async (req) => {
        const body = await readBody(req, CreateThread);
        const id = body.id || crypto.randomUUID();
        // Idempotent like appends: a device replaying a local thread may hit an id we already have.
        const existing = getThread(id);
        if (existing) return json(threadJson(existing));
        const title = (body.title || "Untitled thread").slice(0, 200);
        const thread = createThread(id, title, body.createdAt);
        if (body.seed?.trim()) {
          appendMessage({ id: crypto.randomUUID(), threadId: id, role: "user", content: body.seed.trim() });
          refreshMetadata(id);
        }
        return json(threadJson(thread), 201);
      }),
    },

    "/api/threads/:id": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      GET: wrap((_req, p) => {
        const thread = requireThread(p.id);
        return json({
          thread: threadJson(thread),
          messages: getMessages(p.id).map(messageJson),
          hash: threadHash(thread),
        });
      }),
      PATCH: wrap(async (req, p) => {
        requireThread(p.id);
        const body = await readBody(req, RenameThread);
        if (!body.title?.trim()) throw new HttpError(400, "title is required");
        const thread = renameThread(p.id, body.title, body.renamedAt)!;
        refreshMetadata(p.id);
        return json(threadJson(thread));
      }),
      DELETE: wrap((_req, p) => {
        requireThread(p.id);
        deleteThread(p.id);
        return json({ ok: true });
      }),
    },

    "/api/threads/:id/messages": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (req, p) => {
        requireThread(p.id);
        const body = await readBody(req, AppendMessage);
        if (!body.id || !body.content?.trim()) throw new HttpError(400, "id and content are required");
        const { message, inserted } = appendMessage({
          id: body.id,
          threadId: p.id,
          role: body.role || "user",
          content: body.content.trim(),
          meta: body.meta,
          createdAt: body.createdAt,
        });
        if (inserted) refreshMetadata(p.id);
        return json({ message: messageJson(message), inserted });
      }),
    },

    // Edit in place; the previous text is kept in the message's `edits`.
    "/api/threads/:id/messages/:mid": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      PATCH: wrap(async (req, p) => {
        requireThread(p.id);
        const body = await readBody(req, EditMessage);
        if (!body.content?.trim()) throw new HttpError(400, "content is required");
        const at = Math.min(body.editedAt || Date.now(), Date.now());
        const message = editMessage(p.mid, [{ content: body.content.trim(), at }]);
        if (!message || message.thread_id !== p.id) throw new HttpError(404, "message not found");
        refreshMetadata(p.id);
        return json({ message: messageJson(message) });
      }),
    },

    "/api/threads/:id/ask": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (req, p) => {
        requireThread(p.id);
        const body = await readBody(req, AskThread);
        if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

        const history: ChatMessage[] = getMessages(p.id).map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const messages: ChatMessage[] = [...history, { role: "user", content: body.prompt.trim() }];
        const { text } = await askModel({
          system:
            "You are a thinking partner inside a personal knowledge system. The messages are an existing thread the user is picking back up. Be concise and concrete.",
          messages,
        });

        let committed = false;
        if (body.commit) {
          // Appended AT commit time, not backdated — keeps the log append-only.
          appendMessage({
            id: body.userMessageId || crypto.randomUUID(),
            threadId: p.id,
            role: "user",
            content: body.prompt.trim(),
          });
          appendMessage({
            id: body.assistantMessageId || crypto.randomUUID(),
            threadId: p.id,
            role: "assistant",
            content: text,
          });
          committed = true;
          refreshMetadata(p.id);
        }
        return json({ answer: text, committed });
      }),
    },

    "/api/threads/:id/metadata": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (_req, p) => {
        requireThread(p.id);
        if (!metadataEnabled()) throw new HttpError(503, "metadata generation is off (set THREADZ_METADATA=1)");
        await generateMetadata(p.id);
        return json(threadJson(getThread(p.id)!));
      }),
    },

    // v2 — kept for a future revisit, NOT surfaced in the UI. Embedding-similarity
    // "related threads" wasn't giving meaningful results at personal scale, so the
    // frontend dropped it. Endpoint still works if you curl it.
    "/api/threads/:id/related": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      GET: wrap(async (_req, p) => {
        const thread = requireThread(p.id);
        if (!metadataEnabled()) throw new HttpError(503, "metadata generation is off (set THREADZ_METADATA=1)");
        const all = threadEmbeddings();
        // No stored embedding yet — embed the title on the fly so the result isn't empty.
        const self = all.find((t) => t.id === p.id)?.vec ?? (await embed([thread.title], "query"))[0];
        if (!self) throw new HttpError(502, "embed returned no vector");
        // ponytail: brute-force cosine over every thread. Personal scale = thousands max;
        // swap in sqlite-vec / an ANN index only if this ever gets slow.
        const scored = all
          .filter((t) => t.id !== p.id)
          .map((t) => ({ id: t.id, title: t.title, score: cosine(self, t.vec) }))
          .sort((a, b) => b.score - a.score)
          .filter((r) => r.score > 0.35)
          .slice(0, 5);
        return json(scored);
      }),
    },
  },

  fetch: (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    return json({ error: "not found" }, 404);
  },
});

// Orphan photos: once at start, then daily.
collectOrphanImages();
setInterval(collectOrphanImages, 24 * 3600 * 1000).unref();

console.log(`[threadz] backend on http://0.0.0.0:${server.port}  (LAN: http://<mac-ip>:${server.port})`);

export default server;

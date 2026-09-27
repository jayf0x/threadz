import { applyChanges, type Changes, changesSince, stampRevs, TABLE_NAMES, threadView } from "@threadz/core";
import type { BunRequest } from "bun";
import type { z } from "zod";
import { appendNoteMessage, backupDb, currentRev, driver, ensureSchema, getThread, now } from "./db";
import { collectOrphanImages, imageFile, saveImage } from "./images";
import { askModel, type ChatMessage, CLAUDE_MODEL, HttpError } from "./model";
import { AskBody, PushBody } from "./schemas";

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
      await ensureSchema(); // never a bare 500 from a request racing schema init (see db.ts)
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

// How many rows a push body actually carries, across every table.
const countRows = (c: PushBody) => TABLE_NAMES.reduce((n, t) => n + (c[t]?.length ?? 0), 0);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0", // reachable from the phone over the LAN
  routes: {
    "/api/health": () => json({ ok: true, model: CLAUDE_MODEL }),
    "/api/presence": presence,

    // Pull: "rows with rev > since", plus main's current rev as the new cursor (docs/direction.md
    // "Sync"). `since` defaults to 0, so a fresh device's first pull sees everything.
    "/api/changes": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      GET: wrap(async (req) => {
        const url = new URL(req.url);
        const raw = url.searchParams.get("since");
        const since = raw == null ? 0 : Number(raw);
        if (!Number.isFinite(since) || since < 0) throw new HttpError(400, "since must be a non-negative number");
        const changes = await changesSince(driver, since);
        return json({ changes, cursor: await currentRev() });
      }),
    },

    // Push: a device's pending rows (docs/direction.md "Sync"). Backs main up first (same
    // convention as v1), applies the changeset (`applyChanges` is insert-if-missing for immutable
    // rows and last-write-wins on mutable ones -- see core/merge.ts), stamps every row that just
    // landed with the next rev, and returns those rows stamped -- reusing `changesSince` with the
    // cursor from just before this push -- so the client can update its own cursor without a second
    // round-trip. A retry is harmless: merging is idempotent.
    "/api/push": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (req) => {
        const body = await readBody(req, PushBody);
        if (countRows(body) > 0) backupDb();
        const since = await currentRev();
        await applyChanges(driver, body as unknown as Partial<Changes>);
        const cursor = await stampRevs(driver);
        const changes = await changesSince(driver, since);
        return json({ changes, cursor });
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

    // Ask (docs/direction.md "B10"): push -> ask -> main writes the question and the answer as
    // notes -> pull (the pull itself is the client's job). The thread's transcript is assembled
    // from `core`'s `threadView` query, so main sees exactly what a device would render.
    "/api/ask": {
      OPTIONS: () => new Response(null, { headers: CORS }),
      POST: wrap(async (req) => {
        const body = await readBody(req, AskBody);
        if (!body.threadId || !body.question?.trim()) throw new HttpError(400, "threadId and question are required");
        const thread = await getThread(body.threadId);
        if (!thread) throw new HttpError(404, "thread not found");

        const view = await threadView(driver, body.threadId);
        const history: ChatMessage[] = view.map((row) => ({ role: row.version.author, content: row.version.content }));
        const question = body.question.trim();
        const messages: ChatMessage[] = [...history, { role: "user", content: question }];
        const { text: answer } = await askModel({
          system:
            "You are a thinking partner inside a personal knowledge system. The messages are an existing thread the user is picking back up. Be concise and concrete.",
          messages,
        });

        const since = await currentRev();
        const askedAt = now();
        await appendNoteMessage(driver, body.threadId, question, "user", askedAt);
        // +1 so the answer is never mis-ordered before its question (orderedMessageIds sorts by
        // created_at, then id -- see core/merge.ts).
        await appendNoteMessage(driver, body.threadId, answer, "assistant", askedAt + 1);
        const cursor = await stampRevs(driver);
        const changes = await changesSince(driver, since);
        return json({ answer, changes, cursor });
      }),
    },
  },

  fetch: (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    return json({ error: "not found" }, 404);
  },
});

// Orphan photos: once at start (after schema init -- a fresh threadz.sqlite has no tables yet),
// then daily.
ensureSchema().then(() => collectOrphanImages());
setInterval(collectOrphanImages, 24 * 3600 * 1000).unref();

console.log(`[threadz] backend on http://0.0.0.0:${server.port}  (LAN: http://<mac-ip>:${server.port})`);

export default server;

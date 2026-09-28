/// <reference lib="webworker" />
// The phone's real SQLite handle lives only here (docs/direction.md "Device storage and export"). Loaded
// with `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` from phoneDb.ts — Vite's
// standard worker pattern, which splits this into its own chunk so @subframe7536/sqlite-wasm's wasm never
// reaches the main bundle. Everything crosses the wire as a `PhoneRequest`/`PhoneResponse` (protocol.ts).
// Aliased on import: Biome's react-hooks lint reads any `use*`-named call as a hook (these aren't —
// they're @subframe7536/sqlite-wasm's storage-preset factories, named that way by its own convention).
import { initSQLite } from "@subframe7536/sqlite-wasm";
import { useIdbStorage as idbStorage } from "@subframe7536/sqlite-wasm/idb";
// The package's default wasm loader falls back to `new URL("wa-sqlite-async.wasm", import.meta.url)`
// resolved against its own (pre-bundled) chunk, which Vite doesn't rewrite to a real asset URL — so the
// request 404s and Vite's dev-server SPA fallback serves index.html back instead (the "<!do" magic-byte
// error). Importing the wasm with `?url` puts it through Vite's asset pipeline (a fingerprinted file in
// dev's optimize-deps cache and a real file in `dist/assets/` for prod) and we hand that resolved URL to
// `useIdbStorage` explicitly instead of relying on the library's own resolution.
import wasmAsyncUrl from "@subframe7536/sqlite-wasm/wasm-async?url";
import {
  applyChanges,
  type Changes,
  type Driver,
  initSchema,
  type Param,
  TABLE_NAMES,
  type Table,
} from "@threadz/core";
import { errorMessage } from "@/lib/errors";
import type { PhoneRequest, PhoneResponse } from "./protocol";

type SQLiteDB = Awaited<ReturnType<typeof initSQLite>>;

let db: SQLiteDB | null = null;

const requireDb = (): SQLiteDB => {
  if (!db) throw new Error("phone db not open — send an 'open' request first");
  return db;
};

// The same shape core/bun.ts's bunDriver wraps around bun:sqlite, here around sqlite-wasm's db.run(). tx
// just drives BEGIN/COMMIT/ROLLBACK by hand — the statements inside fn() are further `run`/`all` requests
// from the main-thread proxy, arriving as their own messages, same as bunDriver's caller expects.
const driverOf = (handle: SQLiteDB): Driver => ({
  run: async (sql, params: Param[] = []) => {
    await handle.run(sql, params);
  },
  all: async <T>(sql: string, params: Param[] = []) => (await handle.run(sql, params)) as unknown as T[],
  tx: async (fn) => {
    await handle.run("BEGIN");
    try {
      const result = await fn();
      await handle.run("COMMIT");
      return result;
    } catch (e) {
      await handle.run("ROLLBACK");
      throw e;
    }
  },
});

// @subframe7536/sqlite-wasm@1.3.1's own import path (`db.sync()` / `importDatabase()`, dist/index.js's
// `pagify`/`readExactBytes`) has a real bug: it reads a 32-byte header to verify the magic bytes, THEN
// separately reads `pageCount` more full pages — consuming 32 + pageCount*pageSize bytes total from the
// stream, when a real exported .sqlite file (confirmed against our own `dump()` output, header field
// checked byte-for-byte) is exactly pageCount*pageSize bytes. It also never buffers a chunk's leftover
// bytes across `read()` calls, so unless the stream happens to hand back chunks in exactly that {32,
// pageSize, pageSize, …} shape, bytes go missing. Net effect: any real, multi-page db (i.e. every real
// db) throws "Unexpected EOF" through `db.sync(file)` — confirmed with both a real `File` and a
// hand-rolled single-chunk `ReadableStream`. Reported as a spec ambiguity in the handback; worked around
// here by pre-slicing our own bytes into exactly the shape its reader expects: a throwaway header-sized
// chunk first (its content is only used for the magic-byte check, then discarded), then each real page as
// its own whole chunk — so every `reader.read()` call resolves in one step and nothing is ever discarded.
const streamForImport = (bytes: Uint8Array): ReadableStream<Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPageSize = view.getUint16(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const chunks = [bytes.subarray(0, 32)];
  for (let offset = 0; offset < bytes.length; offset += pageSize)
    chunks.push(bytes.subarray(offset, offset + pageSize));
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++] as Uint8Array);
      else controller.close();
    },
  });
};

// Import path (direction.md "the same merge rules as sync"): load the incoming file's bytes into a
// throwaway scratch db, read every synced table out of it, and hand the resulting changeset to core's own
// `applyChanges` against the already-open phone db — the exact same insert-if-missing / last-write-wins
// merge that a real sync push uses, not a bespoke import path.
const importBytes = async (bytes: Uint8Array): Promise<{ imported: number }> => {
  const temp = await initSQLite(idbStorage("phone-import-scratch.sqlite", { url: wasmAsyncUrl }));
  try {
    await temp.sync(streamForImport(bytes));
    // Assigning per-table into `changes[table]` with `table: Table` (a union key) hits TS's usual
    // write-through-a-union-index restriction, so the target is treated as an untyped bag here — the
    // real per-table shape still comes from `Changes` at every other call site (core/merge.ts, TABLES).
    const changes = {} as Record<Table, unknown[]>;
    for (const table of TABLE_NAMES) changes[table] = await temp.run(`SELECT * FROM ${table}`);
    await applyChanges(driverOf(requireDb()), changes as unknown as Partial<Changes>);
    return { imported: TABLE_NAMES.reduce((n, t) => n + changes[t].length, 0) };
  } finally {
    await temp.close();
  }
};

const handleRequest = async (msg: PhoneRequest): Promise<unknown> => {
  switch (msg.type) {
    case "open":
      db = await initSQLite(idbStorage(msg.name, { url: wasmAsyncUrl }));
      await db.run("PRAGMA cache_size = -65536"); // 64 MB of pages: a repeat scan reads memory, not IndexedDB
      await initSchema(driverOf(db));
      return null;
    case "run":
      await requireDb().run(msg.sql, msg.params);
      return null;
    case "all":
      return await requireDb().run(msg.sql, msg.params);
    case "dump":
      return await requireDb().dump();
    case "importBytes":
      return await importBytes(msg.bytes);
    case "close": {
      const open = requireDb();
      db = null;
      await open.close();
      return null;
    }
  }
};

// @subframe7536/sqlite-wasm's IDBBatchAtomicVFS locking (WebLocksMixin) throws ("lockState.gate is not
// a function") when two requests race against the same handle from the same JS realm — real SQLite
// itself only ever runs one statement at a time anyway, so a request queue here (rather than firing
// `handleRequest` for each message as it arrives) is both the fix and the correct model: every request
// this worker receives runs to completion before the next one starts.
let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<PhoneRequest>) => {
  const msg = e.data;
  queue = queue
    .then(async () => {
      const start = performance.now();
      const result = await handleRequest(msg);
      const transfer = result instanceof Uint8Array ? [result.buffer] : [];
      postMessage({ id: msg.id, ok: true, result, ms: performance.now() - start } satisfies PhoneResponse, transfer);
    })
    .catch((err) => {
      postMessage({ id: msg.id, ok: false, error: errorMessage(err) } satisfies PhoneResponse);
    });
};

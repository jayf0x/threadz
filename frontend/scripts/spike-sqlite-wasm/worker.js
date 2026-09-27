// Throwaway spike worker — NOT wired into the app. See docs/direction.md
// "A. Foundation" items 1/3/4 and backlog.md "Device-only verification".
//
// Retries the wa-sqlite spike (../spike-wa-sqlite/worker.js) with
// @subframe7536/sqlite-wasm instead of plain wa-sqlite — that package ships a
// prebuilt async wasm with FTS5 (trigram tokenizer included) baked in, plus a
// documented IndexedDB-backed storage mode (`useIdbStorage`, `IDBBatchAtomicVFS`
// under the hood) and a `dump()` export helper, instead of us hand-rolling
// `VACUUM INTO` against a second VFS.
//
// Verifies, inside a real Web Worker:
//   1. the package opens a db persisted to IndexedDB (not OPFS).
//   2. FTS5 with the trigram tokenizer works.
//   3. the db's raw bytes can be exported (`db.dump()`) and handed back to the page.
//
// Served from a throwaway static server (see server.ts); paths below are
// resolved against that server's document root.

import { initSQLite } from "/node_modules/@subframe7536/sqlite-wasm/dist/index.js";
import { useIdbStorage } from "/node_modules/@subframe7536/sqlite-wasm/dist/idb.js";

const report = { steps: [], ok: true };

function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => {
      report.steps.push({ name, ok: true, detail: detail ?? null });
    })
    .catch((err) => {
      report.ok = false;
      report.steps.push({ name, ok: false, error: String(err?.stack || err) });
      throw err;
    });
}

async function main() {
  let db;

  await step("open db via useIdbStorage (IndexedDB-backed, not OPFS)", async () => {
    db = await initSQLite(useIdbStorage("spike-sqlite-wasm.db"));
    return { path: db.path, vfsName: db.vfs?.name };
  });

  await step("create + query an ordinary table (sanity)", async () => {
    await db.run("CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, body TEXT)");
    await db.run("INSERT INTO t(body) VALUES (?)", ["hello from the worker"]);
    const rows = await db.run("SELECT body FROM t");
    return { rows };
  });

  await step("FTS5 trigram tokenizer table + query", async () => {
    await db.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS thread_search USING fts5(thread_id UNINDEXED, title, body, tokenize='trigram')",
    );
    await db.run("INSERT INTO thread_search(thread_id, title, body) VALUES (1, 'Resizing images', 'notes about resizing photos on a phone')");
    await db.run("INSERT INTO thread_search(thread_id, title, body) VALUES (2, 'Unrelated', 'nothing to see here')");
    // Mid-word substring match, same style as backend/db.ts's trigram usage.
    const rows = await db.run(`SELECT thread_id FROM thread_search WHERE thread_search MATCH '"izing"' ORDER BY rank`);
    const matchedThreadIds = rows.map((r) => r.thread_id);
    if (matchedThreadIds.length !== 1 || matchedThreadIds[0] !== 1) {
      throw new Error(`expected trigram substring match to find thread_id=1 only, got ${JSON.stringify(matchedThreadIds)}`);
    }
    return { matchedThreadIds };
  });

  let exportedBytes;
  await step("export raw db bytes (db.dump())", async () => {
    exportedBytes = await db.dump();
    if (!exportedBytes || exportedBytes.length === 0) throw new Error("dump() returned no bytes");
    // SQLite files start with this 16-byte magic header.
    const header = new TextDecoder().decode(exportedBytes.slice(0, 15));
    if (header !== "SQLite format 3") {
      throw new Error(`exported bytes don't look like a sqlite file, header=${JSON.stringify(header)}`);
    }
    return { byteLength: exportedBytes.length, header };
  });

  await step("close db", async () => {
    await db.close();
  });

  postMessage({ report, bytes: exportedBytes }, exportedBytes ? [exportedBytes.buffer] : []);
}

main().catch(() => {
  // Failures are already recorded in `report.steps`; still post so the page
  // (and the Playwright driver) sees the failure instead of hanging.
  postMessage({ report, bytes: null });
});

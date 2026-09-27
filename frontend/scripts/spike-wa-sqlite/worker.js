// Throwaway spike worker — NOT wired into the app. See docs/direction.md
// "A. Foundation" items 1/3/4 and backlog.md "Device-only verification".
//
// Verifies, inside a real Web Worker:
//   1. wa-sqlite's async build + IDBBatchAtomicVFS loads and opens a db.
//   2. FTS5 with the trigram tokenizer works.
//   3. The db's raw bytes can be exported and handed back to the page.
//
// Served from a throwaway static server (see server.ts); paths below are
// resolved against that server's document root.

import SQLiteAsyncESMFactory from "/node_modules/wa-sqlite/dist/wa-sqlite-async.mjs";
import * as SQLite from "/node_modules/wa-sqlite/src/sqlite-api.js";
import { IDBBatchAtomicVFS } from "/node_modules/wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { MemoryAsyncVFS } from "/node_modules/wa-sqlite/src/examples/MemoryAsyncVFS.js";

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
  let module;
  let sqlite3;
  let db;

  await step("load async wasm module in worker", async () => {
    module = await SQLiteAsyncESMFactory();
    sqlite3 = SQLite.Factory(module);
    return { hasFactory: typeof sqlite3.open_v2 === "function" };
  });

  await step("register IDBBatchAtomicVFS + open db", async () => {
    const idbVfs = new IDBBatchAtomicVFS("spike-wa-sqlite");
    sqlite3.vfs_register(idbVfs, true);
    db = await sqlite3.open_v2(
      "spike.db",
      SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_URI,
      "spike-wa-sqlite",
    );
    return { vfsName: idbVfs.name };
  });

  await step("create + query an ordinary table (sanity)", async () => {
    await sqlite3.exec(db, "CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, body TEXT)");
    await sqlite3.exec(db, "INSERT INTO t(body) VALUES ('hello from the worker')");
    const rows = [];
    await sqlite3.exec(db, "SELECT body FROM t", (row) => rows.push(row[0]));
    return { rows };
  });

  await step("FTS5 trigram tokenizer table + query", async () => {
    await sqlite3.exec(
      db,
      "CREATE VIRTUAL TABLE IF NOT EXISTS thread_search USING fts5(thread_id UNINDEXED, title, body, tokenize='trigram')",
    );
    await sqlite3.exec(db, "INSERT INTO thread_search(thread_id, title, body) VALUES (1, 'Resizing images', 'notes about resizing photos on a phone')");
    await sqlite3.exec(db, "INSERT INTO thread_search(thread_id, title, body) VALUES (2, 'Unrelated', 'nothing to see here')");
    const rows = [];
    // Mid-word substring match, same style as backend/db.ts's trigram usage.
    await sqlite3.exec(
      db,
      `SELECT thread_id FROM thread_search WHERE thread_search MATCH '"izing"' ORDER BY rank`,
      (row) => rows.push(row[0]),
    );
    if (rows.length !== 1 || rows[0] !== 1) {
      throw new Error(`expected trigram substring match to find thread_id=1 only, got ${JSON.stringify(rows)}`);
    }
    return { matchedThreadIds: rows };
  });

  let exportedBytes;
  await step("export raw db bytes (VACUUM INTO a memory VFS)", async () => {
    const memVfs = new MemoryAsyncVFS();
    sqlite3.vfs_register(memVfs, false);
    // Ask the *source* connection to write the exported copy through a
    // different, explicitly-named VFS via a URI target — this only works
    // because `db` was opened with SQLITE_OPEN_URI above.
    await sqlite3.exec(db, `VACUUM INTO 'file:export.db?vfs=${memVfs.name}'`);
    const file = memVfs.mapNameToFile.get("export.db");
    if (!file) throw new Error("VACUUM INTO did not produce a file on the memory VFS");
    exportedBytes = new Uint8Array(file.data, 0, file.size);
    if (exportedBytes.length === 0) throw new Error("exported file is empty");
    // SQLite files start with this 16-byte magic header.
    const header = new TextDecoder().decode(exportedBytes.slice(0, 15));
    if (header !== "SQLite format 3") {
      throw new Error(`exported bytes don't look like a sqlite file, header=${JSON.stringify(header)}`);
    }
    return { byteLength: exportedBytes.length, header };
  });

  await step("close db", async () => {
    await sqlite3.close(db);
  });

  postMessage({ report, bytes: exportedBytes }, exportedBytes ? [exportedBytes.buffer] : []);
}

main().catch(() => {
  // Failures are already recorded in `report.steps`; still post so the page
  // (and the Playwright driver) sees the failure instead of hanging.
  postMessage({ report, bytes: null });
});

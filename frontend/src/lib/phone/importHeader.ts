// A `.sqlite` opened by main's backend is in WAL mode (header bytes 18/19 = 2), and the wasm VFS can't open a
// WAL-mode file without its -wal/-shm sidecars ("unable to open database file"). An import only ever has the main
// file, so treat it as a rollback-journal database: same pages, flag bytes set to 1. Rows still sitting in an
// un-checkpointed WAL were never in this file and can't be recovered here; a cleanly closed backend checkpoints.
const MAGIC = "SQLite format 3\0";

export const prepareImportBytes = (bytes: Uint8Array): Uint8Array => {
  const isSqlite = bytes.length >= 100 && MAGIC.split("").every((c, i) => bytes[i] === c.charCodeAt(0));
  if (!isSqlite) throw new Error("Not a SQLite database file.");
  if (bytes[18] !== 2 && bytes[19] !== 2) return bytes;
  const copy = bytes.slice();
  copy[18] = 1;
  copy[19] = 1;
  return copy;
};

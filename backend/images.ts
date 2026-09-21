import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DB_PATH, db } from "./db";
import { HttpError } from "./model";

// Images are immutable, content-addressed files (sha256 of the JPEG bytes) that originate on a
// device. They live OUTSIDE SQLite: not in backupDb(), not in /api/snapshot, and they are not
// backed up at all — a photo is never edited, only added.
const dir = () => process.env.THREADZ_IMAGES || join(dirname(resolve(DB_PATH)), "images");

// ponytail: one JPEG is ~300KB after the client compresses it; 8MB is a sanity ceiling, not a design.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/; // also keeps `:hash` from ever being a path

const fileFor = (hash: string) => {
  if (!HASH.test(hash)) throw new HttpError(400, "bad image hash");
  return join(dir(), hash);
};

export const imageFile = (hash: string) => {
  const path = fileFor(hash);
  return existsSync(path) ? Bun.file(path) : null;
};

// Idempotent: the same hash twice is a no-op. The body must really be that hash, and a JPEG.
export const saveImage = async (hash: string, bytes: Uint8Array) => {
  const path = fileFor(hash);
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "image too large");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new HttpError(415, "not a JPEG");
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== hash) throw new HttpError(400, "hash mismatch");
  if (existsSync(path)) return false;
  mkdirSync(dir(), { recursive: true });
  const tmp = `${path}.${crypto.randomUUID().slice(0, 6)}.tmp`;
  await Bun.write(tmp, bytes);
  renameSync(tmp, path); // never a half-written image under its final name
  return true;
};

// --- orphan GC --------------------------------------------------------------------------------
// Conservative: a file goes only if NO message mentions its hash (current text or any kept edit) AND it
// is older than a week — a photo is PUT before the note that shows it, so a fresh file may just be
// waiting for its note. Threads deleted on main are gone from SQLite, so their photos become orphans.

export const ORPHAN_MIN_AGE_MS = 7 * 24 * 3600 * 1000;

const referencedHashes = () => {
  const found = new Set<string>();
  const rows = db.query("SELECT content, edits FROM messages").all() as { content: string; edits: string | null }[];
  for (const { content, edits } of rows)
    for (const m of `${content}\n${edits ?? ""}`.matchAll(/img:([0-9a-f]{64})/g)) found.add(m[1] as string);
  return found;
};

// Returns the hashes it deleted.
export const collectOrphanImages = (now = Date.now(), minAgeMs = ORPHAN_MIN_AGE_MS) => {
  if (!existsSync(dir())) return [];
  const used = referencedHashes();
  const removed: string[] = [];
  for (const name of readdirSync(dir())) {
    if (!HASH.test(name) || used.has(name)) continue; // also skips *.tmp and anything foreign
    const path = join(dir(), name);
    if (now - statSync(path).mtimeMs < minAgeMs) continue;
    unlinkSync(path);
    removed.push(name);
  }
  if (removed.length) console.log(`[threadz] image gc: removed ${removed.length} orphan(s): ${removed.join(" ")}`);
  return removed;
};

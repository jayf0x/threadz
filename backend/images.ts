import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DB_PATH } from "./db";
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

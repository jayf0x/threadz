import { type DBSchema, type IDBPDatabase, openDB } from "idb";

// Photos in notes. A note holds only a reference, `![](img:<sha256hex>#<w>x<h>)`; the bytes live
// here, in their OWN IndexedDB database. Nothing that snapshots, backs up, exports or imports
// (lib/local.ts: exportSnapshot / saveBackup / mergeSnapshot, and the Export backup file) ever reads
// this database, so images can never bloat or leak into a backup. Content-addressed = immutable, so
// there is no image backup at all: `dirty: 1` means "not on main yet", and a dirty row is never deleted.

// --- pure: the reference and the size --------------------------------------------

export type ImageRef = { hash: string; w: number; h: number };

export const formatRef = ({ hash, w, h }: ImageRef) => `img:${hash}#${w}x${h}`;

// The #WxH part is optional (a hand-written ref still resolves, it just gets a default box).
export const parseRef = (src: string): (Omit<ImageRef, "w" | "h"> & Partial<ImageRef>) | null => {
  const m = /^img:([0-9a-f]{64})(?:#(\d+)x(\d+))?$/.exec(src);
  return m ? { hash: m[1], ...(m[2] ? { w: +m[2], h: +m[3] } : {}) } : null;
};

export const MAX_EDGE = 1600;
const QUALITY = 0.8;

// Fit inside MAX_EDGE on the long side; never upscale.
export const fitSize = (w: number, h: number) => {
  const s = Math.min(1, MAX_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
};

// --- the store --------------------------------------------------------------------

type Row = { hash: string; blob: Blob; dirty: 0 | 1 };
interface ImagesDB extends DBSchema {
  images: { key: string; value: Row; indexes: { dirty: number } };
}

let dbp: Promise<IDBPDatabase<ImagesDB>> | null = null;
const getDB = () => {
  dbp ??= openDB<ImagesDB>("threadz-images", 1, {
    upgrade: (db) => void db.createObjectStore("images", { keyPath: "hash" }).createIndex("dirty", "dirty"),
  });
  return dbp;
};

// First write wins: an image we hold (maybe still dirty) is never replaced or demoted by a cached copy.
export const putImage = async (hash: string, blob: Blob, dirty: 0 | 1) => {
  const tx = (await getDB()).transaction("images", "readwrite");
  if (!(await tx.store.get(hash))) await tx.store.put({ hash, blob, dirty });
  await tx.done;
};

export const getImage = async (hash: string) => (await (await getDB()).get("images", hash))?.blob;

export const dirtyImages = async () => (await getDB()).getAllFromIndex("images", "dirty", 1);

// Main acknowledged this image.
export const markImageClean = async (hash: string) => {
  const tx = (await getDB()).transaction("images", "readwrite");
  const row = await tx.store.get(hash);
  if (row) await tx.store.put({ ...row, dirty: 0 });
  await tx.done;
};

// --- browser only: compress a picked file ------------------------------------------

const sha256 = async (blob: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Decode via <img> + canvas (EXIF rotation and HEIC come for free), shrink, re-encode as JPEG (the one
// format every browser can encode), keep it on this device as dirty, and return the markdown ref.
export const attachImage = async (file: File): Promise<string> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("That file isn't an image this browser can open.");
    });
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.fillStyle = "white"; // a PNG's transparency would otherwise turn black in a JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALITY));
    if (!blob) throw new Error("Couldn't encode the image.");
    const hash = await sha256(blob);
    await putImage(hash, blob, 1);
    return formatRef({ hash, w, h });
  } finally {
    URL.revokeObjectURL(url);
  }
};

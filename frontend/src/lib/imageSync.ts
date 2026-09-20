import { fetchImageRemote, putImageRemote } from "./api";
import { attachImage, dirtyImages, getImage, markImageClean, putImage } from "./images";
import { getMode } from "./mode";

// Where images meet main. The bytes only ever move by idempotent PUT/GET of one file; an image is
// marked clean strictly after main acknowledged it. Orphans (an attached image whose note was never sent) are harmless.

// Send every image main doesn't have yet. Runs before the atomic /api/sync (a note must never reach
// main ahead of its image) and, best effort, on every pull while live.
export const pushImages = async () => {
  for (const { hash, blob } of await dirtyImages()) {
    await putImageRemote(hash, blob);
    await markImageClean(hash);
  }
};

// Pick → compress → store on the device → the ref to put in the note. While live, main gets it right away.
export const addImage = async (file: File) => {
  const ref = await attachImage(file);
  if (getMode() === "live") pushImages().catch(() => {}); // failure: stays dirty, the next pull retries
  return ref;
};

// An object URL for an image (the caller revokes it), or null if it is not available here:
// device store first; while live, main as a fallback, cached afterwards. Offline + uncached = null.
export const resolveImage = async (hash: string) => {
  let blob = await getImage(hash);
  if (!blob && getMode() === "live") {
    blob = await fetchImageRemote(hash).catch(() => undefined);
    if (blob) await putImage(hash, blob, 0);
  }
  return blob ? URL.createObjectURL(blob) : null;
};

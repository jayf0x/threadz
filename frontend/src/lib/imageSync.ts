import { fetchImageRemote, putImageRemote } from "./api";
import { ApiError } from "./errors";
import { attachImage, dirtyImages, getImage, markImageClean, putImage } from "./images";
import { getMode } from "./mode";

// Where images meet main. The bytes only ever move by idempotent PUT/GET of one file; an image is
// marked clean strictly after main acknowledged it. Orphans (an attached image whose note was never sent) are harmless.

// A permanent refusal (bad request, wrong type, too large): retrying can never succeed. 408/429 are "later".
const isRefusal = (e: unknown) =>
  e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

// Send every image main doesn't have yet. Runs before the atomic /api/sync (a note must never reach
// main ahead of its image) and, best effort, on every pull while live. An image main refuses for good
// is skipped and returned, so one bad photo cannot wedge the sync; it stays dirty (never deleted) and is
// tried again next time. Any other failure (network, 5xx) still throws: main is not really there.
export const pushImages = async (): Promise<{ skipped: string[] }> => {
  const skipped: string[] = [];
  for (const { hash, blob } of await dirtyImages()) {
    try {
      await putImageRemote(hash, blob);
      await markImageClean(hash);
    } catch (e) {
      if (!isRefusal(e)) throw e;
      skipped.push(hash);
    }
  }
  return { skipped };
};

// Pick → compress → store on the device → the ref to put in the note. While live, main gets it right away.
export const addImage = async (file: File) => {
  const ref = await attachImage(file);
  if (getMode() === "live") pushImages().catch(() => {}); // failure: stays dirty, the next pull retries
  return ref;
};

const sha256Hex = async (blob: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Does the blob hash to its name? null = can't tell (no `crypto.subtle` on plain http).
export const matchesHash = async (hash: string, blob: Blob): Promise<boolean | null> =>
  crypto.subtle ? (await sha256Hex(blob)) === hash : null;

// An object URL for an image (the caller revokes it), or null if it is not available here:
// device store first; while live, main as a fallback, cached afterwards. Offline + uncached = null.
// Bytes from main are cached only if they hash to the name asked for: the store is first-write-wins,
// so a wrong file cached once would stick. A mismatch is dropped; an unverifiable one is shown, not cached.
export const resolveImage = async (hash: string) => {
  let blob = await getImage(hash);
  if (!blob && getMode() === "live") {
    const fetched = await fetchImageRemote(hash).catch(() => undefined);
    const ok = fetched && (await matchesHash(hash, fetched));
    if (fetched && ok) await putImage(hash, fetched, 0);
    if (ok !== false) blob = fetched;
  }
  return blob ? URL.createObjectURL(blob) : null;
};

import { getBackendUrl } from "./config";
import { attachImage, dirtyImages, getImage, markImageClean, putImage } from "./images";

// Where images meet main (docs/direction.md "Images", unchanged by the v2 rebuild — still their own
// content-addressed file per hash, never inside the synced SQLite rows). v1's `ApiError`/`getMode`
// gating is gone: there's no "live" mode any more, so this just tries main directly and treats any
// failure as "try again next time" — the same posture `syncEngine.ts` takes with the rest of a push.

const putImageRemote = async (hash: string, blob: Blob): Promise<void> => {
  const res = await fetch(`${getBackendUrl()}/api/images/${hash}`, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(`image upload failed: ${res.status}`);
};

const fetchImageRemote = async (hash: string): Promise<Blob> => {
  const res = await fetch(`${getBackendUrl()}/api/images/${hash}`);
  if (!res.ok) throw new Error(`image ${res.status}`);
  return res.blob();
};

// A permanent refusal (bad request, wrong type, too large) vs. "try again": without `ApiError`'s
// status code any more, a failed PUT is just always treated as "later" — one bad photo retries
// forever rather than wedging sync, which is the safer default (see `pushImages`' caller).
export const pushImages = async (): Promise<{ skipped: string[] }> => {
  const skipped: string[] = [];
  for (const { hash, blob } of await dirtyImages()) {
    try {
      await putImageRemote(hash, blob);
      await markImageClean(hash);
    } catch {
      skipped.push(hash);
    }
  }
  return { skipped };
};

// Pick → compress → store on the device → the ref to put in the note. Best-effort push right away;
// if main isn't reachable it stays dirty and the next sync (or keep-live tick) carries it.
export const addImage = async (file: File) => {
  const ref = await attachImage(file);
  pushImages().catch(() => {});
  return ref;
};

const sha256Hex = async (blob: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Does the blob hash to its name? null = can't tell (no `crypto.subtle` on plain http).
export const matchesHash = async (hash: string, blob: Blob): Promise<boolean | null> =>
  crypto.subtle ? (await sha256Hex(blob)) === hash : null;

// An object URL for an image (the caller revokes it), or null if it is not available here: device
// store first, main as a fallback (cached afterwards if it hashes to the name asked for). A mismatch
// is dropped; an unverifiable one is shown, not cached.
export const resolveImage = async (hash: string) => {
  let blob = await getImage(hash);
  if (!blob) {
    const fetched = await fetchImageRemote(hash).catch(() => undefined);
    const ok = fetched && (await matchesHash(hash, fetched));
    if (fetched && ok) await putImage(hash, fetched, 0);
    if (ok !== false) blob = fetched;
  }
  return blob ? URL.createObjectURL(blob) : null;
};

import { type DBSchema, type IDBPDatabase, openDB } from "idb";

// Durable, append-only log of a voice recording's transcript, separate from the
// thread mirror/outbox DB on purpose: this is scratch capture state, not synced
// user intent, and it must never share a schema version with the invariant DB.
//
// One record per confirmed VAD segment, written the instant transcription
// finishes — before the text reaches React or the final join. A tab crash /
// iOS background-kill therefore loses at most the single in-flight utterance
// (bounded to ~25s by the hook's force-cut).

const DONE_TTL_MS = 24 * 60 * 60 * 1000; // drop finished recordings after a day

export type Recording = {
  id: string;
  threadId: string;
  startedAt: number;
  endedAt: number | null;
  status: "recording" | "done";
};

type Segment = {
  id: string; // `${recordingId}:${seq}` — makes appendSegment idempotent
  recordingId: string;
  seq: number;
  text: string;
  at: number;
};

interface VoiceDB extends DBSchema {
  recordings: { key: string; value: Recording };
  segments: { key: string; value: Segment; indexes: { byRecording: string } };
}

let dbp: Promise<IDBPDatabase<VoiceDB>> | null = null;
const getDB = () => {
  if (!dbp) {
    dbp = openDB<VoiceDB>("threadz-voice", 1, {
      upgrade(db) {
        db.createObjectStore("recordings", { keyPath: "id" });
        db.createObjectStore("segments", { keyPath: "id" }).createIndex("byRecording", "recordingId");
      },
    });
  }
  return dbp;
};

// test-only: drop the cached connection so a fresh (fake) IndexedDB is picked up
export const _resetForTests = async (): Promise<void> => {
  try {
    (await dbp)?.close();
  } catch {}
  dbp = null;
};

const orderedSegments = async (recordingId: string): Promise<Segment[]> => {
  const rows = await (await getDB()).getAllFromIndex("segments", "byRecording", recordingId);
  return rows.sort((a, b) => a.seq - b.seq);
};

const join = (segs: { text: string }[]) =>
  segs
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");

export const startRecording = async (threadId: string): Promise<string> => {
  // Best-effort: ask the browser not to evict our storage under pressure.
  void navigator.storage?.persist?.().catch(() => {});
  await pruneOld();
  const id = crypto.randomUUID();
  await (await getDB()).put("recordings", {
    id,
    threadId,
    startedAt: Date.now(),
    endedAt: null,
    status: "recording",
  });
  return id;
};

export const appendSegment = async (recordingId: string, seq: number, text: string): Promise<void> => {
  if (!text.trim()) return;
  await (await getDB()).put("segments", {
    id: `${recordingId}:${seq}`,
    recordingId,
    seq,
    text: text.trim(),
    at: Date.now(),
  });
};

export const assemble = async (recordingId: string): Promise<string> => join(await orderedSegments(recordingId));

export const finishRecording = async (recordingId: string): Promise<void> => {
  const db = await getDB();
  const rec = await db.get("recordings", recordingId);
  if (rec) await db.put("recordings", { ...rec, status: "done", endedAt: Date.now() });
};

export const discard = async (recordingId: string): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(["recordings", "segments"], "readwrite");
  await tx.objectStore("recordings").delete(recordingId);
  const seg = tx.objectStore("segments").index("byRecording");
  for (const key of await seg.getAllKeys(recordingId)) await tx.objectStore("segments").delete(key);
  await tx.done;
};

// The newest recording left in `status:"recording"` — i.e. a session the tab
// died in the middle of. Returned so the UI can offer to recover its text.
export const findUnfinished = async (): Promise<{ recordingId: string; lineCount: number; preview: string } | null> => {
  const recs = (await (await getDB()).getAll("recordings"))
    .filter((r) => r.status === "recording")
    .sort((a, b) => b.startedAt - a.startedAt);
  const newest = recs[0];
  if (!newest) return null;
  const segs = await orderedSegments(newest.id);
  if (!segs.length) {
    await discard(newest.id); // nothing captured — don't nag about it
    return null;
  }
  const text = join(segs);
  return { recordingId: newest.id, lineCount: segs.length, preview: text.slice(0, 140) };
};

const pruneOld = async (): Promise<void> => {
  const cutoff = Date.now() - DONE_TTL_MS;
  const stale = (await (await getDB()).getAll("recordings")).filter(
    (r) => r.status === "done" && (r.endedAt ?? r.startedAt) < cutoff,
  );
  for (const r of stale) await discard(r.id);
};

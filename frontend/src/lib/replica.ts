import { fetchHead, remoteApi } from "./api";
import { getOutbox, removeFromOutbox } from "./db";
import { ApiError } from "./errors";
import { pushImages } from "./imageSync";
import { applyRemoteDelete, getBase, localApi, mergeRemoteThread } from "./local";
import { markReplicaReady } from "./mode";

// The device keeps a full copy of main ("replica") plus, per thread, the hash it last
// agreed on with main ("base"). Pulling = ask main for its hashes, fetch only the threads
// whose hash differs from our base, union them in. This runs continuously while live (so
// going offline is always seamless) and once more at the start of every sync.
export type PullReport = {
  threads: number; // threads main changed that we picked up
  messages: number; // notes we didn't have
  removed: number; // deleted on main, followed here (copy kept in trash)
  keptLocal: number; // deleted on main but edited here → kept, will be re-sent
  keptRemote: number; // deleted here but edited on main → brought back
};

export const emptyReport = (): PullReport => ({ threads: 0, messages: 0, removed: 0, keptLocal: 0, keptRemote: 0 });

export const addReports = (a: PullReport, b: PullReport): PullReport => ({
  threads: a.threads + b.threads,
  messages: a.messages + b.messages,
  removed: a.removed + b.removed,
  keptLocal: a.keptLocal + b.keptLocal,
  keptRemote: a.keptRemote + b.keptRemote,
});

// Fetch one thread from main and union it into the device copy.
export const fetchAndMerge = async (id: string) => {
  const { thread, messages, hash } = await remoteApi.getThread(id);
  const r = await mergeRemoteThread(thread, messages, hash ?? "");
  return { ...r, mainIds: new Set(messages.map((m) => m.id)) };
};

const BATCH = 8;

const run = async (): Promise<PullReport> => {
  const report = emptyReport();
  const head = await fetchHead();
  const base = await getBase();
  const changed = Object.keys(head.threads).filter((id) => base[id] !== head.threads[id]);
  const gone = Object.keys(base).filter((id) => !(id in head.threads));

  for (let i = 0; i < changed.length; i += BATCH) {
    await Promise.all(
      changed.slice(i, i + BATCH).map(async (id) => {
        try {
          const r = await fetchAndMerge(id);
          report.threads++;
          report.messages += r.added;
          if (r.resurrected) report.keptRemote++;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e; // deleted since the head read; next pull handles it
        }
      }),
    );
  }
  for (const id of gone) {
    const r = await applyRemoteDelete(id);
    if (r === "removed") report.removed++;
    if (r === "kept") report.keptLocal++;
  }

  markReplicaReady();
  await pushImages().catch(() => {}); // main is reachable (we just read it): send photos it lacks
  await drainOutbox();
  return report;
};

// One pull at a time in this tab.
let inflight: Promise<PullReport> | null = null;
export const pullMain = () => {
  inflight ??= run().finally(() => {
    inflight = null;
  });
  return inflight;
};

// Legacy: drafts queued by the old offline outbox become ordinary pending notes in the device store.
const drainOutbox = async () => {
  for (const o of await getOutbox()) {
    try {
      await localApi.appendMessage(o.threadId, { id: o.id, content: o.content, meta: o.meta, createdAt: o.createdAt });
      await removeFromOutbox(o.id);
    } catch {
      // its thread isn't here (yet): leave the draft where it is
    }
  }
};

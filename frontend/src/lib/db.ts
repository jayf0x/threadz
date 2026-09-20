import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Message, OutboxItem, Thread } from "./types";

// Local mirror + outbox. The mirror is disposable: it gets wholesale-replaced
// from the backend on fetch (no diffing, no merging). The outbox is the only
// thing that holds unsynced user intent.
interface ThreadzDB extends DBSchema {
  threads: { key: string; value: Thread };
  messages: { key: string; value: Message; indexes: { byThread: string } };
  outbox: { key: string; value: OutboxItem; indexes: { byThread: string } };
}

let dbp: Promise<IDBPDatabase<ThreadzDB>> | null = null;

const getDB = () => {
  if (!dbp) {
    dbp = openDB<ThreadzDB>("threadz", 1, {
      upgrade(db) {
        db.createObjectStore("threads", { keyPath: "id" });
        db.createObjectStore("messages", { keyPath: "id" }).createIndex("byThread", "threadId");
        db.createObjectStore("outbox", { keyPath: "id" }).createIndex("byThread", "threadId");
      },
    });
  }
  return dbp;
};

// --- mirror: threads ---

export const putThreads = async (threads: Thread[]) => {
  const db = await getDB();
  const tx = db.transaction("threads", "readwrite");
  await tx.store.clear(); // wholesale replace
  for (const t of threads) await tx.store.put(t);
  await tx.done;
};

export const putThread = async (t: Thread) => (await getDB()).put("threads", t);
export const getThreads = async () => (await getDB()).getAll("threads");
export const getThreadLocal = async (id: string) => (await getDB()).get("threads", id);

// --- mirror: messages for one thread ---

export const replaceThreadMessages = async (threadId: string, messages: Message[]) => {
  const db = await getDB();
  const tx = db.transaction("messages", "readwrite");
  const existing = await tx.store.index("byThread").getAllKeys(threadId);
  for (const k of existing) await tx.store.delete(k);
  for (const m of messages) await tx.store.put(m);
  await tx.done;
};

export const getThreadMessages = async (threadId: string) => {
  const rows = await (await getDB()).getAllFromIndex("messages", "byThread", threadId);
  return rows.sort((a, b) => a.seq - b.seq);
};

// --- outbox ---

export const addToOutbox = async (item: OutboxItem) => (await getDB()).put("outbox", item);
export const getOutbox = async () => (await getDB()).getAll("outbox");
export const getThreadOutbox = async (threadId: string) =>
  (await getDB()).getAllFromIndex("outbox", "byThread", threadId);
export const removeFromOutbox = async (id: string) => (await getDB()).delete("outbox", id);
export const updateOutboxItem = async (item: OutboxItem) => (await getDB()).put("outbox", item);

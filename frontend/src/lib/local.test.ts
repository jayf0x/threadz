import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import {
  commitPush,
  exportSnapshot,
  listTrash,
  localApi,
  mergeSnapshot,
  parseSnapshot,
  seedId,
  unsyncedBatch,
  updateMeta,
} from "./local";
import type { Message, Thread } from "./types";
import { bySeq } from "./versions";

test("local search finds a thread by the text of its notes, not only its title", async () => {
  const a = await localApi.createThread({ title: "Groceries" });
  await localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "remember the Sourdough starter" });
  await localApi.createThread({ title: "Unrelated" });

  expect((await localApi.listThreads("sourdough")).map((t) => t.id)).toEqual([a.id]);
  expect(await localApi.listThreads("no such words anywhere")).toEqual([]);
});

const pushed = { head: "", threads: {}, created: 0, appended: 0, deleted: [], kept: [], missing: [], hashes: {} };

test("a rename or edit made while a push is in flight is not marked clean by that push", async () => {
  const t = await localApi.createThread({ title: "race", seed: "first" });
  await commitPush(await unsyncedBatch(), pushed); // everything so far is clean; the batch below is only this thread
  const note = (await localApi.getThread(t.id)).messages[0]!;
  await localApi.renameThread(t.id, "sent title"); // dirty again
  const sent = await unsyncedBatch();
  await localApi.renameThread(t.id, "renamed mid-push");
  await localApi.editMessage(t.id, note.id, "edited mid-push"); // not in `sent`: was clean
  await commitPush(sent, pushed);

  const left = await unsyncedBatch();
  expect(left.threads.map((x) => x.title)).toEqual(["renamed mid-push"]); // sent "sent title", now differs
  expect(left.messages.map((x) => x.content)).toEqual(["edited mid-push"]);

  await commitPush(left, pushed); // nothing moved since: now it is clean
  expect(await unsyncedBatch()).toMatchObject({ threads: [], messages: [] });
});

test("a thread's seed note has an id both sides can derive, so a retried create dedupes at sync", async () => {
  const id = crypto.randomUUID();
  await localApi.createThread({ id, title: "seeded", seed: "hello" });
  await localApi.createThread({ id, title: "seeded", seed: "hello" }); // the retry
  const { messages } = await localApi.getThread(id);
  expect(messages.map((m) => m.id)).toEqual([seedId(id)]);
});

test("messages that share a seq read in time order", () => {
  const mk = (id: string, seq: number, createdAt: number) => ({ id, seq, createdAt }) as Message;
  const sorted = [mk("c", 2, 5), mk("b", 1, 9), mk("a", 1, 3)].sort(bySeq);
  expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
});

const msg = (threadId: string, id: string, seq: number, content: string): Message => ({
  id,
  threadId,
  role: "user",
  content,
  createdAt: seq,
  seq,
  meta: null,
});

test("import never creates two notes at one seq, and brings back what we trashed that the file lacks", async () => {
  const t = await localApi.createThread({ title: "merge seq", seed: "ours" }); // seq 1
  const merged = await mergeSnapshot({
    version: 1,
    exportedAt: 0,
    threads: [t],
    messages: [msg(t.id, "theirs-1", 1, "theirs one"), msg(t.id, "theirs-2", 2, "theirs two")],
  });
  expect(merged.messages).toBe(2);
  const seqs = (await localApi.getThread(t.id)).messages.map((m) => m.seq);
  expect(new Set(seqs).size).toBe(3);
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

  // deleted here, the file has the thread but not our note: the note comes back with it
  const gone = await localApi.createThread({ title: "trashed", seed: "only on this device" });
  await localApi.deleteThread(gone.id);
  await mergeSnapshot({ version: 1, exportedAt: 0, threads: [gone], messages: [] });
  expect((await localApi.getThread(gone.id)).messages.map((m) => m.content)).toEqual(["only on this device"]);
  expect((await exportSnapshot()).trash?.some((x) => x.thread.id === gone.id)).toBe(false);
});

test("listTrash surfaces deleted threads for Recently Deleted, newest deletion first", async () => {
  const kept = await localApi.createThread({ title: "never deleted" });
  const first = await localApi.createThread({ title: "first deleted" });
  await localApi.deleteThread(first.id);
  const second = await localApi.createThread({ title: "second deleted" });
  await localApi.deleteThread(second.id);

  const trash = await listTrash();
  expect(trash.find((t) => t.id === kept.id)).toBeUndefined();
  expect(trash.find((t) => t.id === first.id)).toMatchObject({ title: "first deleted" });
  expect(trash.find((t) => t.id === second.id)).toMatchObject({ title: "second deleted" });
  const deletedAts = trash.map((t) => t.deletedAt);
  expect(deletedAts).toEqual([...deletedAts].sort((a, b) => b - a));
});

test("a backup file is checked for field types, not just for keys", () => {
  const thread = { id: "t", title: "T", createdAt: 1, updatedAt: 1, tags: [], description: null };
  const message = { id: "m", threadId: "t", role: "user", content: "hi", createdAt: 1, seq: 1, meta: null };
  const file = (over: object = {}, msgOver: object = {}) => ({
    version: 1,
    threads: [{ ...thread, ...over }],
    messages: [{ ...message, ...msgOver }],
  });
  expect(parseSnapshot(file())).not.toBeNull();
  for (const bad of [
    null,
    [],
    "x",
    { ...file(), version: 2 },
    file({ title: 5 }),
    file({ tags: "a" }),
    file({ tags: [1] }),
    file({ description: 7 }),
    file({ createdAt: "1" }),
    file({}, { content: null }),
    file({}, { seq: "1" }),
    file({}, { role: "system" }),
    file({}, { edits: [{ content: 1, at: 1 }] }),
  ])
    expect(parseSnapshot(bad)).toBeNull();
});

test("main's regenerated tags reach a clean device thread, and never overwrite a pending one", async () => {
  const clean = await localApi.createThread({ title: "meta clean" });
  await commitPush(await unsyncedBatch(), pushed); // the device and main now agree
  const pending = await localApi.createThread({ title: "meta pending" });

  const fresh = (t: Thread): Thread => ({
    ...t,
    description: "generated on main",
    tags: ["a", "b"],
    hasEmbedding: true,
  });
  await updateMeta([fresh(clean), fresh(pending)]);
  const after = await localApi.listThreads();
  expect(after.find((t) => t.id === clean.id)).toMatchObject({ description: "generated on main", tags: ["a", "b"] });
  expect(after.find((t) => t.id === pending.id)?.tags).toEqual([]);
});

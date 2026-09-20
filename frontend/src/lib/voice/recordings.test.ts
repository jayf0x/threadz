import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "bun:test";
import {
  _resetForTests,
  appendSegment,
  assemble,
  discard,
  findUnfinished,
  finishRecording,
  startRecording,
} from "./recordings";

// The "no data lost" guarantee: segments are durable and reassemble in order
// even if the recording is never cleanly finished (tab crash / iOS kill).

beforeEach(async () => {
  // fresh IndexedDB per test
  // biome-ignore lint/suspicious/noGlobalAssign: fake-indexeddb's documented reset pattern
  indexedDB = new IDBFactory();
  await _resetForTests();
});

test("segments reassemble in seq order regardless of write order", async () => {
  const rec = await startRecording("thread-1");
  const order = Array.from({ length: 200 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const seq of order) await appendSegment(rec, seq, `w${seq}`);

  const expected = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
  expect(await assemble(rec)).toBe(expected);
});

test("appendSegment is idempotent on (recordingId, seq)", async () => {
  const rec = await startRecording("t");
  await appendSegment(rec, 0, "hello");
  await appendSegment(rec, 0, "hello"); // retry
  await appendSegment(rec, 1, "world");
  expect(await assemble(rec)).toBe("hello world");
});

test("a recording never finished is recoverable with all its segments", async () => {
  const rec = await startRecording("thread-x");
  await appendSegment(rec, 0, "one");
  await appendSegment(rec, 1, "two");
  await appendSegment(rec, 2, "three");
  // no finishRecording() — simulate a crash

  const found = await findUnfinished();
  expect(found?.recordingId).toBe(rec);
  expect(found?.lineCount).toBe(3);
  expect(await assemble(rec)).toBe("one two three");
});

test("finished recordings are not offered for recovery", async () => {
  const rec = await startRecording("t");
  await appendSegment(rec, 0, "done");
  await finishRecording(rec);
  expect(await findUnfinished()).toBeNull();
});

test("an empty unfinished recording is cleaned up, not surfaced", async () => {
  await startRecording("t");
  expect(await findUnfinished()).toBeNull();
});

test("discard removes the recording and its segments", async () => {
  const rec = await startRecording("t");
  await appendSegment(rec, 0, "gone");
  await discard(rec);
  expect(await findUnfinished()).toBeNull();
  expect(await assemble(rec)).toBe("");
});

test("blank segments are dropped from the transcript", async () => {
  const rec = await startRecording("t");
  await appendSegment(rec, 0, "real");
  await appendSegment(rec, 1, "   ");
  await appendSegment(rec, 2, "text");
  expect(await assemble(rec)).toBe("real text");
});

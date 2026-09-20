import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { localApi } from "./local";

test("local search finds a thread by the text of its notes, not only its title", async () => {
  const a = await localApi.createThread({ title: "Groceries" });
  await localApi.appendMessage(a.id, { id: crypto.randomUUID(), content: "remember the Sourdough starter" });
  await localApi.createThread({ title: "Unrelated" });

  expect((await localApi.listThreads("sourdough")).map((t) => t.id)).toEqual([a.id]);
  expect(await localApi.listThreads("no such words anywhere")).toEqual([]);
});

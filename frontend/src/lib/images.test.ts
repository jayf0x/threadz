import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { dirtyImages, fitSize, formatRef, getImage, markImageClean, parseRef, putImage } from "./images";
import { exportSnapshot, latestBackup, localApi, saveBackup } from "./local";

const HASH = "a".repeat(64);

test("refs round-trip, and anything else is left alone", () => {
  const ref = { hash: HASH, w: 1600, h: 1200 };
  expect(formatRef(ref)).toBe(`img:${HASH}#1600x1200`);
  expect(parseRef(formatRef(ref))).toEqual(ref);
  expect(parseRef(`img:${HASH}`)).toEqual({ hash: HASH }); // the #WxH part is optional
  for (const bad of ["https://x.y/a.jpg", "img:abc#1x1", `img:${HASH.toUpperCase()}`, `img:${HASH}#1x`, ""])
    expect(parseRef(bad)).toBeNull();
});

test("fitSize shrinks the long edge to 1600, keeps the ratio, never upscales", () => {
  expect(fitSize(4000, 3000)).toEqual({ w: 1600, h: 1200 });
  expect(fitSize(3000, 4000)).toEqual({ w: 1200, h: 1600 });
  expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  expect(fitSize(20000, 1)).toEqual({ w: 1600, h: 1 });
});

test("an image round-trips byte-identical, stays dirty until acknowledged, and never enters a snapshot or backup", async () => {
  const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) % 256);
  await putImage(HASH, new Blob([bytes], { type: "image/jpeg" }), 1);

  const back = await getImage(HASH);
  expect(back?.type).toBe("image/jpeg");
  expect(new Uint8Array(await back!.arrayBuffer())).toEqual(bytes);

  await putImage(HASH, new Blob(["other"]), 0); // first write wins; a cached copy never replaces or cleans it
  expect((await dirtyImages()).map((r) => r.hash)).toEqual([HASH]);

  // a note that references the photo, then every path that copies the device's data
  const t = await localApi.createThread({ title: "with photo" });
  await localApi.appendMessage(t.id, { id: crypto.randomUUID(), content: `![](img:${HASH}#10x10)` });
  await saveBackup("test");
  const snap = await exportSnapshot();
  expect(Object.keys(snap).sort()).toEqual(["annotations", "exportedAt", "messages", "threads", "trash", "version"]);
  const dump = JSON.stringify(snap) + (await latestBackup())!.json;
  expect(dump).toContain(`img:${HASH}`); // the reference travels with the text …
  expect(dump).not.toContain("image/jpeg"); // … the bytes never do

  await markImageClean(HASH);
  expect(await dirtyImages()).toEqual([]);
  expect(await getImage(HASH)).toBeDefined(); // clean ≠ deleted
});

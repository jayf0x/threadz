import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { clearBackgroundImage, getBackgroundImageBlob, setBackgroundImage } from "./backgroundImage";

test("stores and clears the background image; rejects the wrong type or too large a file", async () => {
  const file = new File([new Uint8Array(10)], "wallpaper.png", { type: "image/png" });
  await setBackgroundImage(file);
  expect(await getBackgroundImageBlob()).toBeDefined();

  await clearBackgroundImage();
  expect(await getBackgroundImageBlob()).toBeUndefined();

  await expect(setBackgroundImage(new File(["not an image"], "doc.pdf", { type: "application/pdf" }))).rejects.toThrow(
    "Pick an image",
  );

  const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.gif", { type: "image/gif" });
  await expect(setBackgroundImage(big)).rejects.toThrow("too large");
});

import { expect, test } from "bun:test";
import { cachedModelIds, downloadPct, findLanguage } from "./models";

const file = (model: string, f: string) => `https://huggingface.co/${model}/resolve/main/onnx/${f}_quantized.onnx`;

test("an unknown or corrupt stored language falls back to auto", () => {
  expect(findLanguage("nl")).toBe("nl");
  expect(findLanguage("klingon")).toBe("auto");
  expect(findLanguage(undefined)).toBe("auto");
  expect(findLanguage(42)).toBe("auto");
});

test("a model counts as downloaded only when encoder and decoder are both cached", () => {
  const urls = [
    file("Xenova/whisper-tiny.en", "encoder_model"),
    file("Xenova/whisper-tiny.en", "decoder_model_merged"),
    file("Xenova/whisper-base", "encoder_model"), // half-finished
  ];
  expect(cachedModelIds(urls)).toEqual(["Xenova/whisper-tiny.en"]);
});

test("a model id that prefixes another is not confused with it", () => {
  const urls = [
    file("Xenova/whisper-tiny.en", "encoder_model"),
    file("Xenova/whisper-tiny.en", "decoder_model_merged"),
  ];
  expect(cachedModelIds(urls)).not.toContain("Xenova/whisper-tiny");
});

test("download % is measured against the model's real size, not just the files seen so far", () => {
  const MB = 1024 * 1024;
  // Only the tiny config/tokenizer files have reported, and they're 100% done: that is ~0% of a 40MB model.
  expect(downloadPct(20_000, 20_000, 40 * MB)).toBe(0);
  expect(downloadPct(20 * MB, 25 * MB, 40 * MB)).toBe(50);
  // The estimate was low: the real total wins, and it never claims done before the model is ready.
  expect(downloadPct(60 * MB, 60 * MB, 40 * MB)).toBe(99);
});

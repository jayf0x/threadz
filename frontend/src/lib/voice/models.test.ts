import { expect, test } from "bun:test";
import { cachedModelIds, findLanguage } from "./models";

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

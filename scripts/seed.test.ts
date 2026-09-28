import { expect, test } from "bun:test";
import { generate } from "./seed";

const hash = (s: "small") => new Bun.CryptoHasher("sha256").update(JSON.stringify(generate(s))).digest("hex");

test("seed: two generations at the same scale produce identical rows", () => {
  expect(hash("small")).toBe(hash("small"));
});

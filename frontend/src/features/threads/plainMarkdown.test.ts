import { expect, test } from "bun:test";
import { parsePlain } from "./plainMarkdown";

test("plain paragraphs, headings and inline marks parse", () => {
  expect(parsePlain("one\n\ntwo")?.map((b) => b.inline[0]?.text)).toEqual(["one", "two"]);
  expect(parsePlain("## Plan")).toEqual([{ level: 2, inline: [{ kind: "text", text: "Plan" }] }]);
  expect(parsePlain("a **b** *c* `d` e")?.[0]?.inline.map((t) => t.kind)).toEqual([
    "text",
    "strong",
    "text",
    "em",
    "text",
    "code",
    "text",
  ]);
});

test("anything the editor renders specially is left to the editor", () => {
  for (const s of [
    "",
    "- item",
    "1. item",
    "/todo x",
    "see [a](tz:thread/x)",
    "![](img:ab#1x1)",
    "> quote",
    "line one\nline two",
    "snake_case",
    "https://example.com",
    "a * b",
    "a &amp; b",
    "```\ncode\n```",
    "#tag",
    "a  b",
  ])
    expect(parsePlain(s)).toBeNull();
});

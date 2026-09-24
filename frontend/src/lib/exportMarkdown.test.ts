import { expect, test } from "bun:test";
import { exportThreadMarkdown } from "./exportMarkdown";
import type { Annotation, Message, Thread } from "./types";

const thread: Thread = {
  id: "t1",
  title: "Trip planning",
  createdAt: 0,
  updatedAt: 0,
  description: null,
  tags: [],
  hasEmbedding: false,
};

// Built with the local `Date` constructor (not `Date.UTC`) and formatted with `format()`, which is
// also local time — so the expected strings below match regardless of the test runner's timezone.
const messages: Message[] = [
  {
    id: "m1",
    threadId: "t1",
    role: "user",
    content: "Where should we go?\n![](img:aaaa#100x100)",
    createdAt: +new Date(2024, 0, 3, 9, 5),
    seq: 0,
    meta: null,
  },
  {
    id: "m2",
    threadId: "t1",
    role: "assistant",
    content: "How about Lisbon?",
    createdAt: +new Date(2024, 0, 3, 9, 7, 30),
    seq: 1,
    meta: null,
  },
];

const annotations: Annotation[] = [
  {
    id: "a1",
    threadId: "t1",
    messageId: "m1",
    content: "check flight prices\nbefore booking",
    createdAt: +new Date(2024, 0, 3, 9, 6),
  },
];

test("assembles a thread into markdown: heading per message, timestamps, inlined annotation, image ref left as-is", () => {
  const md = exportThreadMarkdown(thread, messages, annotations);

  expect(md).toBe(
    `# Trip planning

## You — 3 Jan 2024, 09:05

Where should we go?
![](img:aaaa#100x100)

> **Note** — 3 Jan 2024, 09:06
>
> check flight prices
> before booking

---

## Assistant — 3 Jan 2024, 09:07

How about Lisbon?
`,
  );
});

test("a thread with no annotations and no messages still produces a valid document", () => {
  expect(exportThreadMarkdown(thread, [])).toBe("# Trip planning\n\n\n");
  expect(exportThreadMarkdown(thread, messages)).not.toContain("Note");
});

test("messages are ordered by seq, not array order, and multiple notes on one message stay in creation order", () => {
  const reversed = [messages[1] as Message, messages[0] as Message];
  const twoNotes: Annotation[] = [
    { ...(annotations[0] as Annotation), id: "a2", content: "second", createdAt: +new Date(2024, 0, 3, 9, 6, 30) },
    annotations[0] as Annotation,
  ];

  const md = exportThreadMarkdown(thread, reversed, twoNotes);
  expect(md.indexOf("You")).toBeLessThan(md.indexOf("Assistant"));
  expect(md.indexOf("check flight prices")).toBeLessThan(md.indexOf("second"));
});

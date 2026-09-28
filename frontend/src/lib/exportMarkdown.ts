import { format } from "date-fns";
import { findReferences } from "./references";
import type { Annotation, Message, Thread } from "./types";

// Assembles one thread into a portable markdown document — the pure formatting step behind
// "Export thread as markdown". No file I/O or DOM: callers own writing/sharing the
// result (handoff.ts's `download` already does this for the JSON backup).
//
// Format choices:
//   - One `## ` heading per message (role + human timestamp), messages separated by `---`, rather
//     than jamming everything onto lines — a thread reads like a document, not a log.
//   - Annotations are inlined as a blockquote under the message they're on (they're the person's own
//     context on that message, so dropping them silently would lose information); each keeps its own
//     timestamp. Multiple annotations on one message appear in creation order.
//   - Image references (`![](img:<hash>#WxH)`) are left exactly as stored — resolving them to real
//     bytes is out of scope here (a note only ever holds the reference; bytes live in IndexedDB /
//     THREADZ_IMAGES per AGENTS.md's Images section, not reachable from a pure function).
//   - A `tz:` reference link (`lib/references.ts`) is only meaningful inside this app — its id has
//     nothing to resolve to once the note is opened elsewhere — so it's unwrapped down to its own
//     display text (`readableReferences`), never left as `[text](tz:thread/…)` opaque scheme text.
export const exportThreadMarkdown = (thread: Thread, messages: Message[], annotations: Annotation[] = []): string => {
  const notesByMessage = new Map<string, Annotation[]>();
  for (const a of annotations) notesByMessage.set(a.messageId, [...(notesByMessage.get(a.messageId) ?? []), a]);

  const sections = [...messages]
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      const heading = `## ${m.role === "user" ? "You" : "Assistant"} — ${timestamp(m.createdAt)}`;
      const notes = [...(notesByMessage.get(m.id) ?? [])]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((a) => noteBlock(a))
        .join("\n\n");
      return [heading, readableReferences(m.content), notes].filter(Boolean).join("\n\n");
    });

  return `# ${thread.title}\n\n${sections.join("\n\n---\n\n")}\n`;
};

const timestamp = (at: number) => format(at, "d MMM yyyy, HH:mm");

const noteBlock = (a: Annotation) =>
  `> **Note** — ${timestamp(a.createdAt)}\n>\n${blockquote(readableReferences(a.content))}`;

/** Every `[text](tz:…)` reference link in `content` unwrapped to its own `text` — readable in a
 * plain markdown viewer with no idea what `tz:` means, instead of a dead-looking opaque scheme. */
const readableReferences = (content: string): string => {
  const refs = findReferences(content);
  if (refs.length === 0) return content;
  let out = content;
  for (const ref of [...refs].reverse()) out = out.slice(0, ref.start) + ref.text + out.slice(ref.end);
  return out;
};

const blockquote = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

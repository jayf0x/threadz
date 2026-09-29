// A cheap first paint for a message row (EntryRow): the subset of markdown whose Milkdown rendering is
// trivially reproducible, parsed without loading the editor. Anything outside the subset returns null and the
// row goes straight to its real editor, so the preview can never render something the editor would not.
//
// Subset: blank-line-separated blocks, each ONE line: a `#`..`###` heading or a paragraph of text with
// `**bold**`, `*italic*` and `` `code` `` inline. Everything else (lists, `/todo` lines, links, images, quotes,
// escapes, bare URLs, entities, multi-line blocks) is left to the editor.

export type Inline = { kind: "text" | "strong" | "em" | "code"; text: string };
export type PlainBlock = { level: 0 | 1 | 2 | 3; inline: Inline[] }; // level 0 = paragraph

const UNSUPPORTED = /[[\]<>!\\_~|&]|:\/\/|www\.|^\s|\s$|\s\s/;
const BLOCK_START = /^(?:[-*+/>]|\d+[.)]|`{3})/;

export const parsePlain = (content: string): PlainBlock[] | null => {
  const text = content.trim();
  if (!text) return null;
  const blocks: PlainBlock[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    if (raw.includes("\n") || UNSUPPORTED.test(raw)) return null;
    const heading = /^(#{1,3}) (.+)$/.exec(raw);
    const level = heading ? (heading[1]?.length as 1 | 2 | 3) : 0;
    const body = heading ? (heading[2] ?? "") : raw;
    if ((!heading && BLOCK_START.test(body)) || body.startsWith("#")) return null;
    const inline = parseInline(body);
    if (!inline) return null;
    blocks.push({ level, inline });
  }
  return blocks;
};

const TOKEN = /\*\*(?=\S)([^*]*?\S)\*\*|\*(?=\S)([^*]*?\S)\*|`([^`]+)`/g;

const parseInline = (s: string): Inline[] | null => {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "em", text: m[2] });
    else out.push({ kind: "code", text: m[3] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  // A `*` left over is an unbalanced or intraword marker: the editor decides what that means.
  return out.some((t) => t.kind === "text" && t.text.includes("*")) ? null : out;
};

import type { Message, Thread } from "@/lib/types";

// A new thread is called "Thread: 004" until a note, or you, names it.
const PLACEHOLDER = /^Thread: \d{3,}$/;
const MAX_CHARS = 3000; // what yatefca reads of a thread; the topic is up front, the rest only costs time

const label = (n: number) => `Thread: ${String(n).padStart(3, "0")}`;

// Threads + 1, at least three digits. After a delete that number can already be taken: skip to a free one.
export const nextTitle = (existing: string[]) => {
  const taken = new Set(existing);
  let n = existing.length + 1;
  while (taken.has(label(n))) n++;
  return label(n);
};

// Your own notes as yatefca's input. A photo is `![](img:…)`, not words.
export const noteText = (messages: Message[]) =>
  messages
    .filter((m) => m.role === "user")
    .map((m) => m.content.replace(/!\[\]\(img:[^)]*\)/g, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CHARS);

// yatefca: keyword extraction, no model, works offline. "" when the text is too thin to name anything.
// Loaded on first use so it stays out of the main bundle.
export const titleFrom = async (text: string) => (await import("yatefca")).getTitle(text);

// The title for `thread` after its first note was sent (`previous` undefined) or edited (`previous` = the text
// before the edit), or null to leave it. Only a title nobody chose is replaced: the placeholder, or exactly what
// we derived from the previous text. A name you typed is never touched.
export const autoTitle = async (thread: Thread, first: string, previous?: string): Promise<string | null> => {
  const next = await titleFrom(first);
  if (!next || next === thread.title) return null;
  const ours = PLACEHOLDER.test(thread.title) || (!!previous && thread.title === (await titleFrom(previous)));
  return ours ? next : null;
};

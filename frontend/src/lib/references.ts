// References: linking a thread or a specific message, inline. Decision 1 (backlog.md) is "the
// hybrid" — a trigger drives a live autocomplete while typing, but what's actually stored is a
// real markdown link (`[text](href)`), never the trigger itself. Everything here is pure (no DOM,
// no React, no IndexedDB) so it's independently testable — the two feature/editor files that use it
// (RawEditor's textarea wiring, CrepeEditor's ProseMirror wiring) are the only places this touches
// the outside world.
import { matchScore } from "./search";
import type { Message, Thread } from "./types";

// --- format --------------------------------------------------------------------------------

// The scheme deliberately has NO `word:` prefix. @milkdown/preset-commonmark's link mark runs
// every href through `sanitizeLinkHref` before it reaches the DOM (XSS guard): a destination whose
// leading run of letters is immediately followed by `:` is checked against an allow-list
// (http/https/mailto/tel/ftp) and blanked to `""` if it isn't one of those — so the originally
// floated `link:{thread_id}/{message_id}` spelling (confirmed against the installed package's
// source, not assumed) would render as `<a href="">`, breaking click-to-navigate entirely. A bare
// `key=value` destination has no such leading `scheme:`, so `sanitizeLinkHref` returns it
// unchanged — this is the other spelling decision 1 floated (`thread={id}?message={id}`), used
// here verbatim for that reason.
//
// Forward-compatible with a range fast-follow: `messageId` below is read from a single opaque
// segment. A later range would spell it `?message=<from>..<to>` (double-dot, not the originally
// floated `<from>-<to>` — message ids are UUIDs, which already contain hyphens, so a hyphen
// separator would be ambiguous; `..` isn't a character `crypto.randomUUID()` ever produces) and
// split on that inside `parseReferenceHref` — no change to the href shape itself, so an old
// single-message link keeps parsing exactly as it does today.
const HREF_RE = /^thread=([^?]+)(?:\?message=(.+))?$/;

export const buildReferenceHref = (threadId: string, messageId?: string | null): string =>
  messageId ? `thread=${threadId}?message=${messageId}` : `thread=${threadId}`;

export type ParsedReference = { threadId: string; messageId: string | null };

export const parseReferenceHref = (href: string | null | undefined): ParsedReference | null => {
  if (!href) return null;
  const m = HREF_RE.exec(href);
  const threadId = m?.[1];
  if (!threadId) return null;
  return { threadId, messageId: m?.[2] ?? null };
};

// A completed reference sitting in markdown text: `[display text](thread=…)`. Loose on the display
// text (anything but `]`/newline, same discipline as `lib/todos.ts`'s line matchers — a false
// negative here just leaves a link unrecognized as "one of ours," it never corrupts anything) but
// anchored to our own href shape so an ordinary `[text](https://…)` link never matches.
const REFERENCE_MD_RE = /\[([^\]\n]*)\]\((thread=[^)\s]+)\)/g;

export type CompletedReference = {
  text: string;
  href: string;
  threadId: string;
  messageId: string | null;
  start: number; // index into the source string where `[` sits
  end: number; // index right after the closing `)`
};

/** Every completed reference link in `content`, in source order. The pure "detect a completed
 * reference in text" parser the groundwork item calls for — used by tests, and available to a
 * later feature (e.g. backlinks) without re-deriving this regex. */
export const findReferences = (content: string): CompletedReference[] => {
  const found: CompletedReference[] = [];
  for (const m of content.matchAll(REFERENCE_MD_RE)) {
    const text = m[1] ?? "";
    const href = m[2] ?? "";
    const ref = parseReferenceHref(href);
    if (!ref || m.index == null) continue;
    found.push({
      text,
      href,
      threadId: ref.threadId,
      messageId: ref.messageId,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return found;
};

// --- the trigger + two-stage autocomplete state machine ------------------------------------

// CLI-`cd`-tab-completion-style, per decision 1: `[[` starts a live thread search (chosen over a
// bare `@` since `@/todo`/`@/todos` already own that character as a line-start command trigger —
// `[[` also visually foreshadows the `[text](…)` it becomes, Obsidian/Roam-style). Bounded length
// so a runaway match never scans an entire large message on every keystroke.
export const TRIGGER = "[[";
const MAX_QUERY = 120;
const TRIGGER_RE = new RegExp(`\\[\\[([^\\]\\n]{0,${MAX_QUERY}})$`);

export type ReferenceAutocompleteState =
  | { stage: "closed" }
  | { stage: "thread"; anchor: number; query: string }
  | {
      stage: "message";
      anchor: number; // where the whole reference (the `[`) starts
      linkEnd: number; // where the already-completed thread-only link ends (right after its `)`)
      threadId: string;
      displayText: string; // the thread-only link's own text, carried over rather than guessed again
      query: string;
    };

/** One step of the state machine: given what was true a moment ago and the field's current text +
 * caret, what should be true now. Stateless and pure — the caller (RawEditor's textarea wiring,
 * CrepeEditor's ProseMirror wiring) owns the actual `state`, calling this on every keystroke/caret
 * move, the same way both adapters differ only in how they get `text`/`caret` and how they apply an
 * edit, not in this logic.
 *
 * "thread" is re-derived from scratch every time (so clicking back into an unfinished `[[foo` picks
 * the session back up); "message" is NOT re-derived from arbitrary text — it only exists because
 * `completeThread` below put it there, and only survives while the caret stays put right after the
 * link with nothing but plain query text between (no newline, no bracket) — see `completeThread`'s
 * own comment for why re-deriving it from content instead would be ambiguous. Esc/outside-click
 * (handled by the caller, not this function) always drops straight to `{ stage: "closed" }` without
 * touching any text — which is exactly what leaves a thread-only reference behind afterward: the
 * link itself was already a complete, valid `[text](thread=…)` the moment `completeThread` ran. */
export const nextAutocompleteState = (
  prev: ReferenceAutocompleteState,
  text: string,
  caret: number,
): ReferenceAutocompleteState => {
  if (prev.stage === "message") {
    if (caret >= prev.linkEnd) {
      const between = text.slice(prev.linkEnd, caret);
      if (!/[\n[\]]/.test(between)) return { ...prev, query: between };
    }
    return { stage: "closed" };
  }
  const m = TRIGGER_RE.exec(text.slice(0, caret));
  if (m) {
    const query = m[1] ?? "";
    const anchor = caret - TRIGGER.length - query.length;
    if (prev.stage === "thread" && prev.anchor === anchor) return { stage: "thread", anchor, query };
    return { stage: "thread", anchor, query };
  }
  return { stage: "closed" };
};

export type TextEdit = { from: number; to: number; text: string };

/** Tab/Enter at the thread stage: replace `[[query` with a real, already-closed markdown link —
 * per decision 1 there's only ever one stored representation, so this is the ONLY moment a
 * thread-only reference comes into being; nothing about it is provisional. Hands back the next
 * state too, which is how stage two starts: the caret lands right after the link's `)`, and typing
 * from there is read as a query into that thread's messages (`nextAutocompleteState` above, the
 * `stage: "message"` branch) until Tab/Enter (`completeMessage` below) or Esc/outside-click ends it. */
export const completeThread = (
  state: Extract<ReferenceAutocompleteState, { stage: "thread" }>,
  thread: Pick<Thread, "id" | "title">,
): { edit: TextEdit; next: ReferenceAutocompleteState } => {
  const linkText = `[${thread.title}](${buildReferenceHref(thread.id)})`;
  const to = state.anchor + TRIGGER.length + state.query.length;
  return {
    edit: { from: state.anchor, to, text: linkText },
    next: {
      stage: "message",
      anchor: state.anchor,
      linkEnd: state.anchor + linkText.length,
      threadId: thread.id,
      displayText: thread.title,
      query: "",
    },
  };
};

/** Tab/Enter at the message stage: fold the picked message into the SAME link's href (thread +
 * message) and drop the query text that was typed to find it — the display text is left exactly as
 * `completeThread` set it (or as the user has since edited it; this never re-derives it), matching
 * "editable afterward, not a one-shot locked-in widget." */
export const completeMessage = (
  state: Extract<ReferenceAutocompleteState, { stage: "message" }>,
  message: Pick<Message, "id">,
): { edit: TextEdit; next: ReferenceAutocompleteState } => {
  const linkText = `[${state.displayText}](${buildReferenceHref(state.threadId, message.id)})`;
  return {
    edit: { from: state.anchor, to: state.linkEnd + state.query.length, text: linkText },
    next: { stage: "closed" },
  };
};

// --- local-only search (decision 4) ---------------------------------------------------------

const RESULT_LIMIT = 8;

/** Thread candidates for the trigger stage. Local-copy-only (decision 4): the caller always sources
 * `threads` from `lib/local.ts`'s `exportSnapshot`, never a fetch — same scope as everything else in
 * this app that reads device-local state. Ranked with the same heuristic `lib/local.ts`'s own
 * `listThreads` search uses (`matchScore`); an empty query shows the most recently touched threads
 * instead of an arbitrary/empty list, same "something useful before you've typed anything" idea as
 * a `cd` completion offering the current directory's entries. */
export const searchThreads = (threads: Thread[], query: string, limit = RESULT_LIMIT): Thread[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return threads
    .map((t) => ({ t, score: matchScore(t.title, q) }))
    .filter((r): r is { t: Thread; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.t);
};

/** Message candidates for the message stage, scoped to one thread (per decision 4, still
 * local-copy-only — no fetch for a thread whose messages haven't synced to this device). */
export const searchMessages = (
  messages: Message[],
  threadId: string,
  query: string,
  limit = RESULT_LIMIT,
): Message[] => {
  const scoped = messages.filter((m) => m.threadId === threadId);
  const q = query.trim().toLowerCase();
  if (!q) return scoped.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  return scoped
    .map((m) => ({ m, score: matchScore(m.content, q) }))
    .filter((r): r is { m: Message; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.m);
};

/** A single-line preview of a message for the autocomplete dropdown — the sidebar truncates thread
 * titles with plain CSS (`truncate`; reused as-is for both threads and messages in the dropdown, see
 * `ReferenceAutocompleteMenu.tsx`), but a message has no title at all, so there's nothing for CSS to
 * truncate FROM until raw markdown is flattened to one readable line first. Same "good enough, never
 * loses data it wasn't shown" spirit as `features/threads/titles.ts`'s `noteText`. */
export const messageSnippet = (content: string): string => {
  const line = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line
    .replace(/!\[\]\(img:[^)]*\)/g, "a photo")
    .replace(/[#>*_`~]/g, "")
    .trim();
};

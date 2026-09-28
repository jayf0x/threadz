// References: linking a thread or a specific message, inline. Decision 1 is "the
// hybrid" — a trigger drives a live autocomplete while typing, but what's actually stored is a
// real markdown link (`[text](href)`), never the trigger itself. Everything here is pure (no DOM,
// no React, no IndexedDB) so it's independently testable — `features/editor/MarkdownEditor.tsx`
// (ProseMirror wiring) is the only place this touches the outside world.
import { BUILTIN } from "@threadz/core";
import { matchScore } from "./search";
import type { Message, Thread } from "./types";

// --- format --------------------------------------------------------------------------------

// C14 ("Round 5" of docs/direction.md): one literal grammar for every kind of internal reference,
// `tz:<kind>/<id>@<version>` (version suffix omitted for a live/unpinned reference — nothing writes
// a pinned one yet, C12's version retention isn't wired to references). `REF_SCHEME` is the one
// place any future internal scheme (not just `tz:`) gets registered, per the lead's brief.
//
// @milkdown/preset-commonmark's link mark runs every href through `sanitizeLinkHref` before it
// reaches the DOM (XSS guard): a destination whose leading run of letters is immediately followed
// by `:` is checked against an allow-list (http/https/mailto/tel/ftp) and blanked to `""` if it
// isn't one of those — so a literal `tz:…` href would render as `<a href="">`, breaking
// click-to-navigate entirely. That's resolved in `features/editor/MarkdownEditor.tsx`, not here:
// `commonmark.linkSchema.extendSchema` renders a `tz:` href as `<a data-ref="tz:…">` with no real
// `href` attribute at all, so the sanitizer never runs on it and the browser can never navigate away
// by accident — any other href (a plain `https://` link) goes through the untouched default path.
// This module only owns the string grammar; `isReferenceHref` is what that override keys off.
export const REF_SCHEME = "tz";

// A message reference's `id` is `<threadId>/<from>..<to>` (a range is `<from>..<to>`, double-dot,
// not `<from>-<to>`: message ids are UUIDs, which already contain hyphens, so a hyphen separator
// would be ambiguous; `..` isn't a character `crypto.randomUUID()` ever produces) — a thread
// reference's `id` is just the thread id. A note/link/property-set reference's `id` is just its
// entity id (`core/schema.ts`'s `ENTITY_KINDS`, minus thread/message which get the richer shapes
// above). `kind` says which shape `id` is.
const HREF_RE = /^tz:(thread|message|note|link|property_set)\/([^@]+)(?:@(.+))?$/;
const RANGE_SEP = "..";

export const isReferenceHref = (href: string | null | undefined): boolean =>
  !!href && href.startsWith(`${REF_SCHEME}:`);

/** The `message=` segment for a target: `from`, or `from..to` when `to` is a different message. */
export const messageRangeParam = (from: string, to?: string | null): string =>
  to && to !== from ? `${from}${RANGE_SEP}${to}` : from;

export const buildReferenceHref = (threadId: string, messageId?: string | null, toMessageId?: string | null): string =>
  messageId
    ? `${REF_SCHEME}:message/${threadId}/${messageRangeParam(messageId, toMessageId)}`
    : `${REF_SCHEME}:thread/${threadId}`;

/** A note isn't versioned by `buildReferenceHref`'s caller yet (nothing pins one — see the header
 * comment), but the grammar already carries the suffix for whenever a pin does get written. */
export const buildNoteReferenceHref = (noteId: string, pinnedVersionId?: string | null): string =>
  pinnedVersionId ? `${REF_SCHEME}:note/${noteId}@${pinnedVersionId}` : `${REF_SCHEME}:note/${noteId}`;

export const buildLinkReferenceHref = (linkId: string): string => `${REF_SCHEME}:link/${linkId}`;

export const buildPropertySetReferenceHref = (setId: string): string => `${REF_SCHEME}:property_set/${setId}`;

/** The thread/message shape (unchanged from before this kind broadened — every existing caller of
 * `parseReferenceHref` keeps working against it untouched) or one of the new flat-id kinds. `version`
 * on the thread/message shape is present only for a pinned reference (nothing writes one yet — see
 * the header comment); a note's own `version`, once something does pin one, is what the staleness
 * chip (`core.isReferenceStale`) compares against its latest version. A link/property-set reference
 * is never pinned (neither has a `note_versions`-style history), so those two variants carry no
 * `version` at all. */
export type ParsedReference =
  | { threadId: string; messageId: string | null; toMessageId?: string; version?: string }
  | { kind: "note"; id: string; version?: string }
  | { kind: "link"; id: string }
  | { kind: "property_set"; id: string };

export const parseReferenceHref = (href: string | null | undefined): ParsedReference | null => {
  if (!href) return null;
  const m = HREF_RE.exec(href);
  if (!m) return null;
  const [, kind, id, version] = m;
  if (!id) return null;
  const versionPart = version ? { version } : {};
  if (kind === "thread") return { threadId: id, messageId: null, ...versionPart };
  if (kind === "message") {
    const sep = id.indexOf("/");
    if (sep === -1) return null;
    const threadId = id.slice(0, sep);
    const rangeParam = id.slice(sep + 1);
    if (!threadId || !rangeParam) return null;
    const [from, to] = rangeParam.split(RANGE_SEP);
    if (!from) return null;
    return { threadId, messageId: from, ...(to && to !== from ? { toMessageId: to } : {}), ...versionPart };
  }
  if (kind === "note") return { kind: "note", id, ...versionPart };
  if (kind === "link") return { kind: "link", id };
  return { kind: "property_set", id };
};

/** The messages a `message=`/`?msg=` segment names, out of `ordered` (the thread as it's shown, in
 * whichever sort order): everything between the two endpoints inclusive, whichever comes first on
 * screen — so a range picked backwards, or viewed newest-first, resolves to the same rows. An
 * endpoint no longer in the thread (deleted, not synced) degrades to the other one. */
export const resolveMessageRange = <T extends { id: string }>(ordered: T[], param: string | null | undefined): T[] => {
  if (!param) return [];
  const [from = "", to = from] = param.split(RANGE_SEP);
  const a = ordered.findIndex((m) => m.id === from);
  const b = ordered.findIndex((m) => m.id === to);
  const lo = a === -1 ? b : b === -1 ? a : Math.min(a, b);
  return lo === -1 ? [] : ordered.slice(lo, Math.max(a, b) + 1);
};

// A completed reference sitting in markdown text: `[display text](tz:…)`. Loose on the display
// text (anything but `]`/newline, same discipline as `lib/todos.ts`'s line matchers — a false
// negative here just leaves a link unrecognized as "one of ours," it never corrupts anything) but
// anchored to our own href shape so an ordinary `[text](https://…)` link never matches.
const REFERENCE_MD_RE = /\[([^\]\n]*)\]\((tz:[^)\s]+)\)/g;

/** `text`/`href`/`start`/`end` plus whichever `ParsedReference` shape `href` parses to — spreading
 * `ref` rather than re-listing its fields keeps this in lockstep with `parseReferenceHref` as new
 * kinds are added there. */
export type CompletedReference = { text: string; href: string; start: number; end: number } & ParsedReference;

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
    found.push({ text, href, ...ref, start: m.index, end: m.index + m[0].length });
  }
  return found;
};

// --- the trigger + two-stage autocomplete state machine ------------------------------------

// CLI-`cd`-tab-completion-style, per decision 1: `[[` starts a live thread search (chosen over a
// bare `@`, which the legacy `@/todo` prefix already used; `[[`
// also visually foreshadows the `[text](…)` it becomes, Obsidian/Roam-style). Bounded length
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
      from?: string; // set once a first message is picked: the stage is then the optional "to…" pick of a range
      query: string;
    };

/** One step of the state machine: given what was true a moment ago and the field's current text +
 * caret, what should be true now. Stateless and pure — the caller (`MarkdownEditor`'s ProseMirror
 * wiring) owns the actual `state`, calling this on every keystroke/caret move; how it gets
 * `text`/`caret` and applies an edit is the caller's business, not this logic's.
 *
 * "thread" is re-derived from scratch every time (so clicking back into an unfinished `[[foo` picks
 * the session back up); "message" is NOT re-derived from arbitrary text — it only exists because
 * `completeThread` below put it there, and only survives while the caret stays put right after the
 * link with nothing but plain query text between (no newline, no bracket) — see `completeThread`'s
 * own comment for why re-deriving it from content instead would be ambiguous. Esc/outside-click
 * (handled by the caller, not this function) always drops straight to `{ stage: "closed" }` without
 * touching any text — which is exactly what leaves a thread-only reference behind afterward: the
 * link itself was already a complete, valid `[text](tz:thread/…)` the moment `completeThread` ran. */
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
 * "editable afterward, not a one-shot locked-in widget."
 *
 * Ranges: the FIRST pick doesn't end the autocomplete — the state stays at the message stage with
 * `from` set (same "continue until Esc" shape as thread → message), so the very same popup now
 * offers the range's end. The single-message link is already complete and valid at that point, so
 * Esc/outside-click leaves it behind exactly like a thread-only one. The `from` message is pinned
 * first in the list (`searchMessages`' `pinId`), so a bare Enter/Tab right after picking confirms
 * "just this one" instead of silently extending to some other message; picking it again (or any
 * message, in either order) closes — a range's endpoints are normalized by `resolveMessageRange`
 * against the displayed order, not here. `href` is handed back for the WYSIWYG adapter, which
 * applies the link mark itself rather than splicing `edit.text`. */
export const completeMessage = (
  state: Extract<ReferenceAutocompleteState, { stage: "message" }>,
  message: Pick<Message, "id">,
): { edit: TextEdit; next: ReferenceAutocompleteState; href: string } => {
  const href = buildReferenceHref(state.threadId, state.from ?? message.id, state.from ? message.id : null);
  const linkText = `[${state.displayText}](${href})`;
  const edit = { from: state.anchor, to: state.linkEnd + state.query.length, text: linkText };
  if (state.from) return { edit, next: { stage: "closed" }, href };
  return {
    edit,
    next: { ...state, linkEnd: state.anchor + linkText.length, from: message.id, query: "" },
    href,
  };
};

/** Tab/Enter at the trigger stage for a note/link/property-set pick: unlike `completeThread`, this
 * closes the autocomplete immediately — a note/link/property-set has no second "narrow further"
 * stage the way a thread's messages do (nothing to pick after picking a link). `href` is built by
 * the caller (`buildNoteReferenceHref`/`buildLinkReferenceHref`/`buildPropertySetReferenceHref`),
 * same "hand back `href` for the WYSIWYG adapter" contract as `completeMessage`. */
export const completeSimpleReference = (
  state: Extract<ReferenceAutocompleteState, { stage: "thread" }>,
  displayText: string,
  href: string,
): { edit: TextEdit; next: ReferenceAutocompleteState } => {
  const linkText = `[${displayText}](${href})`;
  const to = state.anchor + TRIGGER.length + state.query.length;
  return { edit: { from: state.anchor, to, text: linkText }, next: { stage: "closed" } };
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
  pinId?: string, // with an empty query, this message leads the list (a range's already-picked start)
): Message[] => {
  const scoped = messages.filter((m) => m.threadId === threadId);
  const q = query.trim().toLowerCase();
  if (!q) {
    const newestFirst = scoped.sort((a, b) => b.createdAt - a.createdAt);
    const pinned = newestFirst.find((m) => m.id === pinId);
    return (pinned ? [pinned, ...newestFirst.filter((m) => m !== pinned)] : newestFirst).slice(0, limit);
  }
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

// --- note/link/property-set candidates (wave 6 phase 2: references to anything) -------------

/** Any live note (`lib/data.ts`'s `listAllNotes`/`core.allNotes`) offered as a `tz:note/<id>`
 * candidate. A note is one entity however many messages place it, so it is offered once, under its
 * note id; the `message` kind stays the positional "this spot in that thread" reference, reached
 * through a thread pick, never listed alongside. `searchNotes` dedupes by id as a guard. */
export type NoteRefCandidate = { entityId: string; content: string; createdAt: number };

export const searchNotes = (notes: NoteRefCandidate[], query: string, limit = RESULT_LIMIT): NoteRefCandidate[] => {
  const q = query.trim().toLowerCase();
  const unique = [...new Map(notes.map((n) => [n.entityId, n])).values()];
  if (!q) return unique.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  return unique
    .map((n) => ({ n, score: matchScore(messageSnippet(n.content), q) }))
    .filter((r): r is { n: NoteRefCandidate; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.n);
};

/** A link (`lib/data.ts`'s `listLinkCandidates`/`core.listLinks`) offered as a `tz:link/<id>`
 * candidate, labelled by its best-effort type value. */
export type LinkRefCandidate = { id: string; label: string };

export const searchLinks = (links: LinkRefCandidate[], query: string, limit = RESULT_LIMIT): LinkRefCandidate[] => {
  const q = query.trim().toLowerCase();
  if (!q) return links.slice(0, limit); // already newest-updated first (core.listLinks)
  return links
    .map((l) => ({ l, score: matchScore(l.label, q) }))
    .filter((r): r is { l: LinkRefCandidate; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.l);
};

/** A property set (`lib/data.ts`'s `listPropertySets`/`core.propertySets`) offered as a
 * `tz:property_set/<id>` candidate. */
export type PropertySetRefCandidate = { id: string; name: string };

const BUILTIN_IDS: ReadonlySet<string> = new Set(Object.values(BUILTIN));

export const searchPropertySets = (
  sets: PropertySetRefCandidate[],
  query: string,
  limit = RESULT_LIMIT,
): PropertySetRefCandidate[] => {
  const q = query.trim().toLowerCase();
  const custom = sets.filter((s) => !BUILTIN_IDS.has(s.id));
  if (!q) return custom.slice(0, limit);
  return custom
    .map((s) => ({ s, score: matchScore(s.name, q) }))
    .filter((r): r is { s: PropertySetRefCandidate; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.s);
};

import {
  allEntries,
  allInsights,
  allNotes,
  applyChanges,
  BUILTIN,
  type Changes,
  annotationsFor as coreAnnotationsFor,
  counterValue as coreCounterValue,
  isReferenceStale as coreIsReferenceStale,
  linksFor as coreLinksFor,
  listLinks as coreListLinks,
  otherThreadsForNote as coreOtherThreadsForNote,
  propertySets as corePropertySets,
  propertyValuesFor as corePropertyValuesFor,
  searchThreadIds as coreSearchThreadIds,
  todos as coreTodos,
  type Driver,
  generateSeed,
  type Insight,
  initSchema,
  type LinkWithType,
  type MapFilter,
  mapFilterOptions,
  mapTracks,
  orderedMessageIds,
  pool,
  SCALES,
  TABLE_NAMES,
  type ThreadEntry,
  threadEntries,
  threadView,
  todoScan,
  type ValueType,
} from "@threadz/core";

import { emitChange, onChange } from "./changeSignal";
import { clearImages } from "./images";
import { openPhoneDb } from "./phoneDb";
import type { Annotation, Link, Message, PropertySet, PropertyValue, Thread, Version } from "./types";

// The v2 frozen contract (docs/direction.md "Data model" + "Sync"): a thin async facade over one
// shared `phoneDb` instance and `core`'s query functions, exposing what the app's hooks need.
// Every write goes straight through `core`'s `Driver` — INSERT/UPDATE against the tables in
// core/schema.ts — and calls `emitChange()` when it lands, per lib/changeSignal.ts. There is no
// "live"/"local" duality any more: the phone always reads and writes this database; main is a pure
// sync target (`syncEngine.ts`).

let dbPromise: ReturnType<typeof openPhoneDb> | null = null;

// Exposed for syncEngine.ts (push/pull needs the same driver + db handle) and DataSection's
// export/import, which touch the raw `.sqlite` file rather than going through queries.
export const getPhoneDb = () => {
  if (!dbPromise) dbPromise = openPhoneDb();
  return dbPromise;
};

const driver = async (): Promise<Driver> => (await getPhoneDb()).driver;

const uuid = () => crypto.randomUUID();

// Reads that several panels make of the same state (Home and Todos both scan the todos, the index and Home both list
// threads, and a panel mounts again each time its tab opens) run once until the next change signal. Every write and
// every sync that moved rows emits one, and that ends the sharing: a read started after a write never gets an answer
// to one started before it.
let generation = 0;
onChange(() => {
  generation++;
});
const shared = <T>(read: () => Promise<T>): (() => Promise<T>) => {
  let last: { generation: number; result: Promise<T> } | null = null;
  return () => {
    if (last && last.generation === generation) return last.result;
    const mine = { generation, result: read() };
    last = mine;
    mine.result.catch(() => {
      if (last === mine) last = null;
    });
    return mine.result;
  };
};

// --- reading -------------------------------------------------------------------------------

export const listThreads = shared(async (): Promise<Thread[]> => {
  const d = await driver();
  const rows = await d.all<{ id: string; title: string; created_at: number; updated_at: number }>(
    `SELECT t.id, t.title, e.created_at, t.updated_at FROM threads t
     JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL
     ORDER BY t.updated_at DESC`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
});

export const getThread = async (id: string): Promise<Thread | null> => {
  const d = await driver();
  const [row] = await d.all<{ id: string; title: string; created_at: number; updated_at: number }>(
    `SELECT t.id, t.title, e.created_at, t.updated_at FROM threads t
     JOIN entities e ON e.id = t.id WHERE t.id = ? AND e.deleted_at IS NULL`,
    [id],
  );
  return row ? { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at } : null;
};

// A core `ThreadEntry` in the shape `EntryRow`/`lib/todos.ts`/`lib/versions.ts` already expect (see
// lib/types.ts's `Message` for why it stays close to v1's shape). `seq` is the message's position in display
// order, replacing v1's stored column.
const toMessage = (e: ThreadEntry, seq: number): Message => ({
  id: e.message.id,
  threadId: e.message.thread_id,
  role: e.version.author,
  content: e.version.content,
  createdAt: e.created_at,
  seq,
  meta: e.todo ? { todo: { done: !!e.todo.done } } : null,
  editedAt: e.edited_at,
  edits: e.edits.map((v) => ({ content: v.content, at: v.created_at })),
  metaEditedAt: e.todo?.updated_at ?? null,
});

// A thread's messages, oldest first: four statements however long the thread is (`core.threadEntries`).
export const threadMessages = async (threadId: string): Promise<Message[]> => {
  const d = await driver();
  return (await threadEntries(d, threadId)).map((e, i) => toMessage(e, i + 1));
};

// Every thread's messages, flattened — what a cross-thread scan (References autocomplete's local
// search, image GC) needs in place of v1's `exportSnapshot`. There is no JSON snapshot any more
// (direction.md's "Device storage and export": a full device backup is now the phone's own `.sqlite`
// bytes, via `phoneDb.dump()`/`exportFile()`), so this is a plain live read: four statements in all.
export const allMessages = async (): Promise<{ threads: Thread[]; messages: Message[] }> => {
  const d = await driver();
  const threads = await listThreads();
  const byThread = await allEntries(d);
  const messages = threads.flatMap((t) => (byThread.get(t.id) ?? []).map((e, i) => toMessage(e, i + 1)));
  return { threads, messages };
};

// What the image GC keeps images for: every version (kept edits included) of the notes live messages place in
// live threads, reduced to the ones that mention an image; `null` when the device has no live message at all
// (nothing to judge by, so nothing to sweep). Two statements, and only the matching rows come back.
export const imageBearingTexts = async (): Promise<string[] | null> => {
  const d = await driver();
  const placed = `SELECT m.note_id FROM messages m
    JOIN entities me ON me.id = m.id AND me.deleted_at IS NULL
    JOIN entities te ON te.id = m.thread_id AND te.deleted_at IS NULL
    WHERE m.removed_at IS NULL`;
  const [any] = await d.all<{ one: number }>(`SELECT 1 AS one FROM (${placed}) LIMIT 1`);
  if (!any) return null;
  const rows = await d.all<{ content: string }>(
    `SELECT v.content FROM note_versions v WHERE v.content LIKE '%img:%' AND v.note_id IN (${placed})`,
  );
  return rows.map((r) => r.content);
};

// What the Todos lens reads instead of `allMessages`: only the messages that can hold a todo (a flagged
// message, or text with a `/todo`, `/todos` or checkbox line), without their edit history (`core.todoScan`).
// `lib/todos.ts`'s parser is still the judge of what counts.
export const todoMessages = shared(async (): Promise<{ threads: Thread[]; messages: Message[] }> => {
  const d = await driver();
  const [threads, rows] = await Promise.all([listThreads(), todoScan(d)]);
  const messages = rows.map(
    (r, i): Message => ({
      id: r.id,
      threadId: r.thread_id,
      role: "user",
      content: r.content,
      createdAt: r.created_at,
      seq: i + 1,
      meta: r.todo ? { todo: { done: !!r.todo.done } } : null,
      editedAt: r.edited_at,
      metaEditedAt: r.todo?.updated_at ?? null,
    }),
  );
  return { threads, messages };
});

// Which of a thread's live messages have a row (the placement itself, or its note's newest version)
// still waiting for main to stamp a `rev` — replaces v1's per-message `dirty` flag for the "only on
// this device so far" cloud-off icon (EntryRow.tsx).
export const pendingMessageIds = async (threadId: string): Promise<Set<string>> => {
  const d = await driver();
  const rows = await d.all<{ id: string }>(
    `SELECT m.id FROM messages m
     LEFT JOIN note_versions v ON v.note_id = m.note_id
       AND v.created_at = (SELECT MAX(v2.created_at) FROM note_versions v2 WHERE v2.note_id = m.note_id)
     WHERE m.thread_id = ? AND (m.rev IS NULL OR v.rev IS NULL)`,
    [threadId],
  );
  return new Set(rows.map((r) => r.id));
};

// A thread's attached notes (docs/direction.md "Links have no kind column": a note plus a link
// carrying the built-in `attached` property value, replacing v1's `annotations` table), one flat
// array across every message — `ThreadView.tsx` builds its own `messageId → note` lookup from this.
// `id` is the note's own entity id (mirrors `Message.id` being the placement id, content pulled from
// versions); `edits`/`editedAt` come from that note's version history, same as `Message`'s.
// A note's other, earlier versions (oldest first) plus whether the newest one counts as "edited" (more than
// one version ever written). One query per attached note: a thread has few of them.
const versionHistory = async (d: Driver, noteId: string, currentId: string) => {
  const rows = await d.all<{ id: string; content: string; created_at: number }>(
    "SELECT id, content, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at, id",
    [noteId],
  );
  const edits: Version[] = rows
    .filter((r) => r.id !== currentId)
    .map((r) => ({ content: r.content, at: r.created_at }));
  const editedAt = edits.length ? (rows.at(-1)?.created_at ?? null) : null;
  return { edits, editedAt };
};

export const annotationsFor = async (threadId: string): Promise<Annotation[]> => {
  const d = await driver();
  const rows = await coreAnnotationsFor(d, threadId);
  const out: Annotation[] = [];
  for (const r of rows) {
    const [entity] = await d.all<{ created_at: number }>("SELECT created_at FROM entities WHERE id = ?", [r.note_id]);
    const { edits, editedAt } = await versionHistory(d, r.note_id, r.version.id);
    out.push({
      id: r.note_id,
      threadId,
      messageId: r.message_id,
      content: r.version.content,
      createdAt: entity?.created_at ?? r.version.created_at,
      editedAt,
      edits,
    });
  }
  return out;
};

// The `unsyncedAnnotations` analogue of `pendingMessageIds`, keyed by the note's own id (matches
// `Annotation.id`, what `NoteSurface`/`EntryRow` check): an attached note is pending if its link or
// its newest version hasn't been stamped with a `rev` yet, same two rows `pendingMessageIds` checks
// for a plain message (the placement row and its note's newest version).
export const unsyncedAnnotationIds = async (threadId: string): Promise<Set<string>> => {
  const d = await driver();
  const rows = await coreAnnotationsFor(d, threadId);
  const out = new Set<string>();
  for (const r of rows) if (r.link.rev == null || r.version.rev == null) out.add(r.note_id);
  return out;
};

export type PoolItem = { entityId: string; createdAt: number; content: string };

export const listPool = shared(async (): Promise<PoolItem[]> => {
  const d = await driver();
  const rows = await pool(d);
  return rows.map((r) => ({ entityId: r.entity_id, createdAt: r.created_at, content: r.version.content }));
});

// Every live note once each (placed or not) — the `[[` autocomplete's note candidates.
export const listAllNotes = async (): Promise<PoolItem[]> => {
  const d = await driver();
  const rows = await allNotes(d);
  return rows.map((r) => ({ entityId: r.entity_id, createdAt: r.created_at, content: r.version.content }));
};

export type { Insight };

export const listInsights = async (): Promise<Insight[]> => allInsights(await driver(), Date.now());

export type BinItem = { id: string; kind: "thread" | "note"; title: string; deletedAt: number };

// The Bin (docs/direction.md "C11"): threads and notes with `deleted_at` set — a deleted message is
// only ever the cascade side-effect of one of those two (see `deleteThread`/`deleteNote`), so it's
// filtered out here rather than shown as its own confusing row. `title` is the thread's own title,
// or a snippet of the note's latest content.
export const listBin = async (): Promise<BinItem[]> => {
  const d = await driver();
  const rows = await d.all<{
    id: string;
    kind: string;
    deleted_at: number;
    title: string | null;
    content: string | null;
  }>(
    `SELECT e.id, e.kind, e.deleted_at, t.title,
       (SELECT content FROM note_versions v WHERE v.note_id = e.id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) AS content
     FROM entities e LEFT JOIN threads t ON t.id = e.id
     WHERE e.deleted_at IS NOT NULL AND e.kind IN ('thread', 'note') ORDER BY e.deleted_at DESC`,
  );
  return rows.map((r) =>
    r.kind === "thread"
      ? { id: r.id, kind: "thread", title: r.title ?? "Untitled thread", deletedAt: r.deleted_at }
      : { id: r.id, kind: "note", title: (r.content ?? "").slice(0, 80) || "Empty note", deletedAt: r.deleted_at },
  );
};

// Thread ids matching `query` (`core.searchThreadIds`: notes' threads first, then title hits).
export const searchThreadIds = async (query: string): Promise<string[]> => coreSearchThreadIds(await driver(), query);

// Property sets on offer for `threadId` (its own scoped sets plus every global one) — the Settings
// section lists the global ones (filter out `threadId`-scoped and, there, the built-ins too), the
// message ⋯ menu's "Add property" picker lists all of it. Built-in sets (`BUILTIN`) come back like
// any other live set; callers that shouldn't offer them for manual attachment filter by id.
// Link candidates for the `[[` reference autocomplete's "any link" search (lib/references.ts's
// `searchLinks`) — every live link, labelled by its best-effort type value (`core.listLinks`).
export const listLinkCandidates = async (): Promise<{ id: string; label: string }[]> => {
  const d = await driver();
  const rows = await coreListLinks(d);
  return rows.map((r) => ({ id: r.id, label: r.label }));
};

// Whether a pinned `tz:note/<id>@<version>` reference is stale (docs/direction.md "Versions") — the
// reference autocomplete's staleness chip (`features/editor/staleReferenceDecoration.ts`) reads this.
export const isReferenceStale = async (noteId: string, pinnedVersionId: string): Promise<boolean> => {
  const d = await driver();
  return coreIsReferenceStale(d, noteId, pinnedVersionId);
};

export const listPropertySets = async (threadId?: string): Promise<PropertySet[]> => {
  const d = await driver();
  const rows = await corePropertySets(d, threadId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    valueType: r.value_type,
    scopeThreadId: r.scope_thread_id,
    rule: r.rule,
    colorSlot: r.color_slot,
  }));
};

// Live property values on any entity (note, message, thread or link — `targetId` is generic), joined
// to enough of their set to render straight into a `Chip`. Already excludes inert values (their set
// tombstoned) and removed values — see `core.propertyValuesFor`.
export const propertyValuesFor = async (targetId: string): Promise<PropertyValue[]> => {
  const d = await driver();
  const rows = await corePropertyValuesFor(d, targetId);
  return rows.map((r) => ({
    id: r.value.id,
    setId: r.set.id,
    setName: r.set.name,
    valueType: r.set.value_type,
    colorSlot: r.set.color_slot,
    targetId: r.value.target_id,
    value: r.value.value,
    createdAt: r.value.created_at,
  }));
};

// Resolve one `LinkWithType` row (core/queries.ts) to the view shape `Link` above — joins the type
// value's own set (for its colour/name) since `core.linksFor` only resolves as far as the raw
// `property_values` row. N+1 (one extra lookup per typed link), same "fine at POC scale" pattern as
// `versionHistory`/`todoFor` above.
const resolveLink = async (d: Driver, row: LinkWithType): Promise<Link> => {
  let type: Link["type"] = null;
  if (row.type_value) {
    const [set] = await d.all<{ name: string; color_slot: number | null }>(
      "SELECT name, color_slot FROM property_sets WHERE id = ?",
      [row.type_value.set_id],
    );
    if (set)
      type = {
        setId: row.type_value.set_id,
        setName: set.name,
        colorSlot: set.color_slot,
        value: row.type_value.value,
      };
  }
  return {
    id: row.link.id,
    fromId: row.link.from_id,
    toId: row.link.to_id,
    pinVersionId: row.link.pin_version_id,
    updatedAt: row.link.updated_at,
    type,
  };
};

// A "connection" (docs/direction.md Decision 3) an entity is either end of — the selection-to-link
// flow (`features/editor/SelectionMenu.tsx`) reads a message's outgoing links to render type chips;
// a later "gutter"/peek lens reads both directions of any entity.
export const linksFor = async (entityId: string): Promise<{ outgoing: Link[]; incoming: Link[] }> => {
  const d = await driver();
  const { outgoing, incoming } = await coreLinksFor(d, entityId);
  return {
    outgoing: await Promise.all(outgoing.map((r) => resolveLink(d, r))),
    incoming: await Promise.all(incoming.map((r) => resolveLink(d, r))),
  };
};

// The `counter` rule's computed number for a message (docs/direction.md "Rules are computed, not
// stored") — never stored, recomputed from the thread's live order on every read.
export const counterValueFor = async (setId: string, messageId: string): Promise<number | null> => {
  const d = await driver();
  return coreCounterValue(d, setId, messageId);
};

// Whether a thread carries the built-in `local-only` flag (Round 6: "Ask is disabled/greyed out for
// that thread"). Wiring Ask's disabled state to this is a later step; this just exposes the read.
export const isThreadLocalOnly = async (threadId: string): Promise<boolean> => {
  const values = await propertyValuesFor(threadId);
  return values.some((v) => v.setId === BUILTIN.localOnly);
};

// --- gutter marks + peek (docs/direction.md "Lenses": Gutter, Peek) ------------------------------

export type GutterOtherThread = { messageId: string; threadId: string; threadTitle: string };
export type GutterLink = { linkId: string; direction: "in" | "out"; otherId: string; typeLabel: string | null };
export type GutterMarks = { otherThreads: GutterOtherThread[]; links: GutterLink[] };

// A message's gutter marks: the other live threads its note is also placed in, and its links in/out
// — the note's own links count too (docs/direction.md "Gutter": "links in/out"), since a link can be
// made from either the placement or the underlying note. Values and todo are already available via
// `propertyValuesFor`/`Message.meta.todo`, so this only covers the two marks that need a fresh query.
export const gutterMarksFor = async (messageId: string): Promise<GutterMarks> => {
  const d = await driver();
  const [msg] = await d.all<{ note_id: string }>("SELECT note_id FROM messages WHERE id = ?", [messageId]);
  if (!msg) return { otherThreads: [], links: [] };

  const others = await coreOtherThreadsForNote(d, msg.note_id, messageId);
  const otherThreads = others.map((o) => ({
    messageId: o.message_id,
    threadId: o.thread_id,
    threadTitle: o.thread_title,
  }));

  // A link can be made from the message's placement or from its note directly — dedupe by link id
  // so a link touching both (unusual, but not ruled out) isn't shown twice.
  const links = new Map<string, GutterLink>();
  for (const entityId of [messageId, msg.note_id]) {
    const { outgoing, incoming } = await coreLinksFor(d, entityId);
    for (const l of outgoing)
      links.set(l.link.id, {
        linkId: l.link.id,
        direction: "out",
        otherId: l.link.to_id,
        typeLabel: l.type_value?.value ?? null,
      });
    for (const l of incoming)
      links.set(l.link.id, {
        linkId: l.link.id,
        direction: "in",
        otherId: l.link.from_id,
        typeLabel: l.type_value?.value ?? null,
      });
  }
  return { otherThreads, links: [...links.values()] };
};

// The computed map (core/map.ts): the same async facade as every other read.
export const loadMapTracks = async (filter: MapFilter) => mapTracks(await driver(), filter);
export const loadMapFilterOptions = async () => mapFilterOptions(await driver());

export type PeekAnchor = { threadId: string; messageId: string };

// Resolves whatever a gutter mark points at (a message, a note, or a thread — the entity kinds a
// link or an "other thread" mark can realistically name) down to "a thread plus the message to
// centre the peek window on". A note with no live placement (Pool) or an entity kind with no
// sensible thread context (a link, a property set) has nothing to peek at — `null`.
export const resolvePeekAnchor = async (entityId: string): Promise<PeekAnchor | null> => {
  const d = await driver();
  const [message] = await d.all<{ id: string; thread_id: string }>(
    "SELECT m.id, m.thread_id FROM messages m JOIN entities e ON e.id = m.id WHERE m.id = ? AND m.removed_at IS NULL AND e.deleted_at IS NULL",
    [entityId],
  );
  if (message) return { threadId: message.thread_id, messageId: message.id };

  const [entity] = await d.all<{ kind: string }>("SELECT kind FROM entities WHERE id = ? AND deleted_at IS NULL", [
    entityId,
  ]);
  if (!entity) return null;

  if (entity.kind === "thread") {
    const ids = await orderedMessageIds(d, entityId);
    const first = ids[0];
    return first ? { threadId: entityId, messageId: first } : null;
  }
  if (entity.kind === "note") {
    const [placement] = await coreOtherThreadsForNote(d, entityId);
    return placement ? { threadId: placement.thread_id, messageId: placement.message_id } : null;
  }
  return null;
};

// The "todo" gutter mark: whether this message carries a `todos` row, and its done state — `null`
// when it isn't a todo at all (nothing to mark).
export const todoStatusFor = async (messageId: string): Promise<{ done: boolean } | null> => {
  const d = await driver();
  const [row] = await d.all<{ done: number }>("SELECT done FROM todos WHERE target_id = ?", [messageId]);
  return row ? { done: !!row.done } : null;
};

export type PeekMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: number };

// A thread's messages in a small window around `aroundMessageId` (docs/direction.md "Peek": "one
// linked entity plus its neighbours in its own thread") — reuses the frozen `threadView` query
// (display order + live/pinned content) rather than a bespoke SQL string, then slices to `radius` on
// each side instead of loading the whole thread. Deliberately skips edit history/todo enrichment
// (`threadMessages`'s N+1 joins) since a peek is a quick glance, not the full thread view.
export const peekWindow = async (threadId: string, aroundMessageId: string, radius = 2): Promise<PeekMessage[]> => {
  const d = await driver();
  const rows = await threadView(d, threadId);
  const index = rows.findIndex((r) => r.message.id === aroundMessageId);
  if (index < 0) return [];
  const start = Math.max(0, index - radius);
  const slice = rows.slice(start, index + radius + 1);
  const out: PeekMessage[] = [];
  for (const r of slice) {
    const [entity] = await d.all<{ created_at: number }>("SELECT created_at FROM entities WHERE id = ?", [
      r.message.id,
    ]);
    out.push({
      id: r.message.id,
      role: r.version.author,
      content: r.version.content,
      createdAt: entity?.created_at ?? r.version.created_at,
    });
  }
  return out;
};

// --- writing ---------------------------------------------------------------------------------

const now = () => Date.now();

const insertEntity = (d: Driver, id: string, kind: string, at: number) =>
  d.run("INSERT INTO entities (id, kind, created_at, updated_at, deleted_at, rev) VALUES (?, ?, ?, ?, NULL, NULL)", [
    id,
    kind,
    at,
    at,
  ]);

const touchThread = (d: Driver, threadId: string, at: number) =>
  Promise.all([
    d.run("UPDATE threads SET updated_at = ? WHERE id = ?", [at, threadId]),
    d.run("UPDATE entities SET updated_at = ? WHERE id = ?", [at, threadId]),
  ]);

// Places a brand-new note as the message at position `at` (a plain timestamp — order is derived
// from `created_at` per core/merge.ts's `orderedMessageIds`, so distinct `at`s keep insertion order
// even within one tight loop, e.g. `copyThread` below).
const placeNewNote = async (d: Driver, threadId: string, content: string, author: "user" | "assistant", at: number) => {
  const noteId = uuid();
  const versionId = uuid();
  const messageId = uuid();
  await insertEntity(d, noteId, "note", at);
  await d.run(
    "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
    [versionId, noteId, content, author, at],
  );
  await insertEntity(d, messageId, "message", at);
  await d.run(
    "INSERT INTO messages (id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, NULL, NULL)",
    [messageId, threadId, noteId, at],
  );
  return { noteId, messageId };
};

// Settings > Import: merge a `.sqlite` file's rows in, then tell every lens to re-read.
export const importDatabaseFile = async (file: File): Promise<{ imported: number }> => {
  const result = await (await getPhoneDb()).importFile(file);
  emitChange();
  return result;
};

export const createThread = async (title: string): Promise<Thread> => {
  const d = await driver();
  const id = uuid();
  const at = now();
  await d.tx(async () => {
    await insertEntity(d, id, "thread", at);
    await d.run("INSERT INTO threads (id, title, updated_at, rev) VALUES (?, ?, ?, NULL)", [id, title, at]);
  });
  emitChange();
  return { id, title, createdAt: at, updatedAt: at };
};

export const renameThread = async (id: string, title: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?", [title, at, id]);
    await d.run("UPDATE entities SET updated_at = ? WHERE id = ?", [at, id]);
  });
  emitChange();
};

// Appends a note as the newest message in a thread — never touches `thread_order` (an append can
// never conflict with a reorder, per core/merge.ts).
export const appendNote = async (
  threadId: string,
  content: string,
  author: "user" | "assistant" = "user",
): Promise<string> => {
  const d = await driver();
  const at = now();
  const { messageId } = await d.tx(async () => {
    const r = await placeNewNote(d, threadId, content, author, at);
    await touchThread(d, threadId, at);
    return r;
  });
  emitChange();
  return messageId;
};

// Places an *existing* note (typically a Pool note, docs/direction.md "Round 6": "Pool... a note
// belongs to no thread") as a new, live message in `threadId` — unlike `copyThread`'s version
// references, `pin_version_id` stays NULL so the placement tracks the note's live content, same as
// any other freshly-composed message. This is the write that removes a note from the Pool: the
// query (`core.pool`) is "no live message points at this note", and this is what makes one point at
// it. Reused by anything else that ever needs to re-place a loose note (a future gutter/reference
// action), not just the Pool view.
export const placeExistingNote = async (threadId: string, noteId: string): Promise<string> => {
  const d = await driver();
  const at = now();
  const messageId = await d.tx(async () => {
    const id = uuid();
    await insertEntity(d, id, "message", at);
    await d.run(
      "INSERT INTO messages (id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, NULL, NULL)",
      [id, threadId, noteId, at],
    );
    await touchThread(d, threadId, at);
    return id;
  });
  emitChange();
  return messageId;
};

// An edit is a new `note_versions` row (docs/direction.md "Versions"), never an update to an
// existing one — immutable rows are insert-if-missing on sync. A pinned message (a Clone
// reference, `pin_version_id` set — see `copyThread`/`placeVersionReference`) shares its note with
// whatever it was cloned from, so writing the new version there alone would silently land the edit
// on the OTHER (usually live) thread while this message kept showing the stale pinned version. To
// keep an edit going where it looks like it's going, editing a pinned message re-pins it to the
// version it just wrote — it stops being frozen the moment it's touched, but the edit lands here,
// not somewhere else.
export const editMessage = async (messageId: string, content: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [row] = await d.all<{ note_id: string; thread_id: string; pin_version_id: string | null; author: string }>(
    `SELECT m.note_id, m.thread_id, m.pin_version_id, v.author FROM messages m
     JOIN note_versions v ON v.note_id = m.note_id
     WHERE m.id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 1`,
    [messageId],
  );
  if (!row) throw new Error(`message ${messageId} not found`);
  await d.tx(async () => {
    const versionId = uuid();
    await d.run(
      "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
      [versionId, row.note_id, content, row.author, at],
    );
    if (row.pin_version_id)
      await d.run("UPDATE messages SET pin_version_id = ?, updated_at = ? WHERE id = ?", [versionId, at, messageId]);
    else await d.run("UPDATE messages SET updated_at = ? WHERE id = ?", [at, messageId]);
    await touchThread(d, row.thread_id, at);
  });
  emitChange();
};

// Remove a message from a thread (docs/direction.md "C11"): a tombstone on the *message* row
// (`removed_at`), never the note's own entity — the note goes to the Pool automatically the moment
// no live message points at it (see core/queries.ts's `pool`), and stays exactly where it is if it's
// still placed somewhere else.
export const removeMessage = async (messageId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [row] = await d.all<{ thread_id: string }>("SELECT thread_id FROM messages WHERE id = ?", [messageId]);
  await d.tx(async () => {
    await d.run("UPDATE messages SET removed_at = ?, updated_at = ? WHERE id = ?", [at, at, messageId]);
    if (row) await touchThread(d, row.thread_id, at);
  });
  emitChange();
};

// Delete a thread (C11): the thread entity and every one of its messages tombstone together,
// restorable as one Bin entry. Notes left with no other placement surface in the Pool, not the Bin.
export const deleteThread = async (threadId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, threadId]);
    const rows = await d.all<{ id: string }>("SELECT id FROM messages WHERE thread_id = ?", [threadId]);
    for (const r of rows)
      await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, r.id]);
  });
  emitChange();
};

// Delete a note placed in several threads (C11): the note gets `deleted_at`, and every message
// that placed it (in any thread) tombstones with it — disappears everywhere at once, one Bin entry.
export const deleteNote = async (noteId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, noteId]);
    const rows = await d.all<{ id: string }>("SELECT id FROM messages WHERE note_id = ?", [noteId]);
    for (const r of rows)
      await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, r.id]);
  });
  emitChange();
};

// The Bin's one Undo: the exact inverse of the two deletes above, dispatched on the entity's own
// `kind` (Bin rows already carry it — see `listBin`).
export const restoreFromBin = async (id: string, kind: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ?", [at, id]);
    const col = kind === "thread" ? "thread_id" : kind === "note" ? "note_id" : null;
    if (!col) return;
    const rows = await d.all<{ id: string }>(`SELECT id FROM messages WHERE ${col} = ?`, [id]);
    for (const r of rows) await d.run("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ?", [at, r.id]);
  });
  emitChange();
};

// `null` clears the flag entirely (no `todos` row at all, so it drops out of the Todos lens);
// `true`/`false` upserts it. There's no soft-delete column on `todos` in core/schema.ts, so
// clearing is a real DELETE — acceptable for one phone/one main; sync just never sees the row again.
export const setTodo = async (targetId: string, done: boolean | null): Promise<void> => {
  const d = await driver();
  const at = now();
  if (done === null) await d.run("DELETE FROM todos WHERE target_id = ?", [targetId]);
  else
    await d.run(
      `INSERT INTO todos (target_id, done, updated_at, rev) VALUES (?, ?, ?, NULL)
       ON CONFLICT(target_id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at, rev = NULL`,
      [targetId, done ? 1 : 0, at],
    );
  emitChange();
};

// Whether `targetId` (any entity — a message or a thread alike) carries a live `todos` row, and
// its done state if so. `null` = not flagged at all, distinct from `false` (flagged, still open) —
// same distinction the message ⋯ menu's Todo toggle already relies on (`EntryRow`'s `todo` vs
// `m.meta?.todo?.done`). Generic on purpose: a thread's own id works exactly like a message's.
export const todoStatus = async (targetId: string): Promise<boolean | null> => {
  const d = await driver();
  const [row] = await d.all<{ done: number }>("SELECT done FROM todos WHERE target_id = ?", [targetId]);
  return row ? !!row.done : null;
};

export type ThreadTodoItem = {
  threadId: string;
  threadTitle: string;
  done: boolean;
  createdAt: number;
  closedAt: number;
};

// Thread-level todos (Round 6: a todo on a thread's own entity id, not just a message's) for the
// Todos lens (features/todos/useTodos.ts) — `core.todos` already returns every kind generically,
// this just resolves the `thread` ones back to a title + creation time via `listThreads`. Per
// AGENTS.md "one tab, one job", this is Todos-only: the Threadz index never reads it.
export const threadTodos = shared(async (): Promise<ThreadTodoItem[]> => {
  const d = await driver();
  const rows = await coreTodos(d);
  const threads = await listThreads();
  const byId = new Map(threads.map((t) => [t.id, t]));
  const out: ThreadTodoItem[] = [];
  for (const r of rows) {
    if (r.kind !== "thread") continue;
    const t = byId.get(r.target_id);
    if (!t) continue; // deleted (or otherwise gone) thread — listThreads already excludes it
    out.push({ threadId: t.id, threadTitle: t.title, done: !!r.done, createdAt: t.createdAt, closedAt: r.updated_at });
  }
  return out;
});

// The live-or-pinned version id for a note right now — same resolution core/queries.ts's private
// `resolveVersion` does, replicated here because that helper isn't part of core's exported surface
// (only the query functions built on it are). Only the id is needed by `placeVersionReference`
// below, not the full row. Exported for data.test.ts, which drives it against a real `Driver`
// (`@threadz/core/bun`) since `copyThread` itself is pinned to the worker-backed phone db singleton
// (see phone/driver.test.ts's comment on why that boundary isn't exercised by `bun test`).
export const resolveLiveVersionId = async (
  d: Driver,
  noteId: string,
  pinVersionId: string | null,
): Promise<string | null> => {
  if (pinVersionId) {
    const [v] = await d.all<{ id: string }>("SELECT id FROM note_versions WHERE id = ?", [pinVersionId]);
    if (v) return v.id;
  }
  const [v] = await d.all<{ id: string }>(
    "SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [noteId],
  );
  return v?.id ?? null;
};

// Places a *version reference* to an existing note (docs/direction.md Decision 9: "Clone and Copy
// become version references") — no new note, no new note_versions row, just a new `messages`
// placement. `pinVersionId` freezes it to that exact version (a "Clone"); `null` leaves it live,
// following the note's newest version as it changes (a "Branch" — see `cloneOrBranchThread` below).
// Exported for data.test.ts (see that function's comment).
export const placeVersionReference = async (
  d: Driver,
  threadId: string,
  noteId: string,
  pinVersionId: string | null,
  at: number,
) => {
  const messageId = uuid();
  await insertEntity(d, messageId, "message", at);
  await d.run(
    "INSERT INTO messages (id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
    [messageId, threadId, noteId, pinVersionId, at],
  );
  return messageId;
};

// The shared mechanism behind "Clone from here" and "Branch from here" (AGENTS.md's Composer/
// EntryRow ⋯ menu; Round 6: "Two separate ⋯ menu items... same mechanism, [branch] pins left
// empty, so it follows the original's live version"): a new thread holding *version references* to
// A's messages up to and including `uptoMessageId` (docs/direction.md Decision 9), plus optionally
// one more brand-new note appended after them. `pin: true` (Clone) freezes each reference to the
// version live right now, so it stays frozen even if the original note is edited later; `pin: false`
// (Branch) leaves `pin_version_id` null, so it keeps following the original as it's edited.
const cloneOrBranchThread = async (
  threadId: string,
  uptoMessageId: string,
  opts: { pin: boolean; titlePrefix: string; appendContent?: string },
): Promise<Thread> => {
  const d = await driver();
  const ids = await orderedMessageIds(d, threadId);
  const cut = ids.indexOf(uptoMessageId);
  const keep = cut >= 0 ? ids.slice(0, cut + 1) : ids;
  const [src] = await d.all<{ title: string }>("SELECT title FROM threads WHERE id = ?", [threadId]);
  const newId = uuid();
  const at0 = now();
  const title = `${opts.titlePrefix}${src?.title ?? "Untitled"}`.slice(0, 200);
  await d.tx(async () => {
    await insertEntity(d, newId, "thread", at0);
    await d.run("INSERT INTO threads (id, title, updated_at, rev) VALUES (?, ?, ?, NULL)", [newId, title, at0]);
    let at = at0;
    for (const id of keep) {
      const [row] = await d.all<{ note_id: string; pin_version_id: string | null }>(
        "SELECT note_id, pin_version_id FROM messages WHERE id = ?",
        [id],
      );
      if (!row) continue;
      // Resolved (and checked for existence) either way — a branch still needs to know the note has
      // at least one version before placing a reference to it, it just doesn't pin to what it found.
      const versionId = await resolveLiveVersionId(d, row.note_id, row.pin_version_id);
      if (!versionId) continue;
      at += 1;
      await placeVersionReference(d, newId, row.note_id, opts.pin ? versionId : null, at);
    }
    const extra = opts.appendContent?.trim();
    if (extra) {
      at += 1;
      await placeNewNote(d, newId, extra, "user", at);
    }
  });
  emitChange();
  return { id: newId, title, createdAt: at0, updatedAt: at0 };
};

export const copyThread = (threadId: string, uptoMessageId: string, appendContent?: string): Promise<Thread> =>
  cloneOrBranchThread(threadId, uptoMessageId, { pin: true, titlePrefix: "Copy: ", appendContent });

// "Branch from here" (Round 6): same as `copyThread`, except every reference is left live instead of
// frozen, so the new thread keeps following the original's edits from this point on.
export const branchThread = (threadId: string, uptoMessageId: string, appendContent?: string): Promise<Thread> =>
  cloneOrBranchThread(threadId, uptoMessageId, { pin: false, titlePrefix: "Branch: ", appendContent });

// The live `attached` link for a message, if any (id + its note's id) — used to enforce "one note per
// message" on write and to find the note/link pair to edit or delete. "Live" means both the link's own
// entity and the note's entity have no `deleted_at` (a delete tombstones both, per "Round 5 C11").
const attachedLinkFor = async (d: Driver, messageId: string) => {
  const [row] = await d.all<{ id: string; note_id: string }>(
    `SELECT l.id, l.from_id AS note_id FROM links l
     JOIN entities le ON le.id = l.id
     JOIN entities ne ON ne.id = l.from_id
     JOIN property_values pv ON pv.target_id = l.id AND pv.set_id = ? AND pv.removed_at IS NULL
     WHERE l.to_id = ? AND le.deleted_at IS NULL AND ne.deleted_at IS NULL`,
    [BUILTIN.attached, messageId],
  );
  return row ?? null;
};

// The live `attached` link that points *from* a note (the inverse of `attachedLinkFor`) — used by
// edit/delete, which are only ever called with the note's own id (`Annotation.id`).
const attachedLinkFrom = async (d: Driver, noteId: string) => {
  const [row] = await d.all<{ id: string; message_id: string }>(
    `SELECT l.id, l.to_id AS message_id FROM links l
     JOIN entities le ON le.id = l.id
     JOIN property_values pv ON pv.target_id = l.id AND pv.set_id = ? AND pv.removed_at IS NULL
     WHERE l.from_id = ? AND le.deleted_at IS NULL`,
    [BUILTIN.attached, noteId],
  );
  return row ?? null;
};

// Attach a new note to a message (docs/direction.md "Links have no kind column"): a new note +
// its first version, then a link (`from` = the note, `to` = the message) carrying the built-in
// `attached` property value. "One per message, DB-enforced" (EntryRow's own comment) has no schema-
// level unique constraint, so this write path enforces it itself: it refuses (throws) rather than
// silently upserting, since the UI only ever calls this when it believes there's no note yet
// (`EntryRow`'s "Add note" only renders with none) — a throw here means a stale read, worth surfacing
// as an error rather than quietly overwriting.
export const addAnnotation = async (messageId: string, content: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [msg] = await d.all<{ thread_id: string }>("SELECT thread_id FROM messages WHERE id = ?", [messageId]);
  if (!msg) throw new Error(`message ${messageId} not found`);
  await d.tx(async () => {
    if (await attachedLinkFor(d, messageId)) throw new Error(`message ${messageId} already has an attached note`);
    const noteId = uuid();
    const linkId = uuid();
    await insertEntity(d, noteId, "note", at);
    await d.run(
      "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, 'user', ?, NULL)",
      [uuid(), noteId, content, at],
    );
    await insertEntity(d, linkId, "link", at);
    await d.run(
      "INSERT INTO links (id, from_id, to_id, pin_version_id, updated_at, rev) VALUES (?, ?, ?, NULL, ?, NULL)",
      [linkId, noteId, messageId, at],
    );
    await d.run(
      "INSERT INTO property_values (id, set_id, target_id, value, created_at, updated_at, removed_at, rev) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)",
      [uuid(), BUILTIN.attached, linkId, at, at],
    );
    await touchThread(d, msg.thread_id, at);
  });
  emitChange();
};

// An edit is a new `note_versions` row on the same note (docs/direction.md "Versions"), never an
// update to an existing one — same pattern as `editMessage`. `noteId` is the note's own id
// (`Annotation.id`), not the message id.
export const editAnnotation = async (noteId: string, content: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const [row] = await d.all<{ author: "user" | "assistant" }>(
    "SELECT author FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [noteId],
  );
  if (!row) throw new Error(`note ${noteId} not found`);
  await d.tx(async () => {
    await d.run(
      "INSERT INTO note_versions (id, note_id, parent_id, content, author, created_at, rev) VALUES (?, ?, NULL, ?, ?, ?, NULL)",
      [uuid(), noteId, content, row.author, at],
    );
    const link = await attachedLinkFrom(d, noteId);
    if (link) {
      const [msg] = await d.all<{ thread_id: string }>("SELECT thread_id FROM messages WHERE id = ?", [
        link.message_id,
      ]);
      if (msg) await touchThread(d, msg.thread_id, at);
    }
  });
  emitChange();
};

// Delete an attached note (docs/direction.md "Round 5 C11": "Delete a link... tombstone only
// (`deleted_at`)"): tombstones both the note entity and the link entity, never a hard delete. Either
// one's `deleted_at` is enough for `core.annotationsFor` to exclude it (it checks both); tombstoning
// both keeps the note out of the Pool too (`core.pool` only surfaces live notes).
export const deleteAnnotation = async (noteId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const link = await attachedLinkFrom(d, noteId);
  await d.tx(async () => {
    await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, noteId]);
    if (link) await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, link.id]);
  });
  emitChange();
};

// --- property sets & values --------------------------------------------------------------------

// The next colour slot in the round-robin (docs/direction.md "8 colour slots... a new property set
// gets UI for free"): every set gets a colour by default rather than rendering colourless chips, and
// a plain count-mod-8 keeps consecutive new sets visually distinct without asking the user to pick.
const nextColorSlot = async (d: Driver) => {
  const [row] = await d.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM property_sets ps JOIN entities e ON e.id = ps.id WHERE e.deleted_at IS NULL`,
  );
  return ((row?.n ?? 0) % 8) + 1;
};

// Create a property set (docs/direction.md "C13"): global (`scopeThreadId` omitted) or scoped to one
// thread — thread-scoped sets are created from context (a thread's own UI), never from Settings,
// which only manages global ones. `colorSlot` defaults to the next free-ish slot if not given.
export const createPropertySet = async (
  name: string,
  valueType: ValueType,
  opts?: { scopeThreadId?: string; rule?: "counter" | null; colorSlot?: number },
): Promise<PropertySet> => {
  const d = await driver();
  const id = uuid();
  const at = now();
  const colorSlot = await d.tx(async () => {
    const slot = opts?.colorSlot ?? (await nextColorSlot(d));
    await insertEntity(d, id, "property_set", at);
    await d.run(
      "INSERT INTO property_sets (id, name, value_type, scope_thread_id, rule, color_slot, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      [id, name, valueType, opts?.scopeThreadId ?? null, opts?.rule ?? null, slot, at],
    );
    return slot;
  });
  emitChange();
  return {
    id,
    name,
    valueType,
    scopeThreadId: opts?.scopeThreadId ?? null,
    rule: opts?.rule ?? null,
    colorSlot,
  };
};

export const renamePropertySet = async (id: string, name: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.tx(async () => {
    await d.run("UPDATE property_sets SET name = ?, updated_at = ? WHERE id = ?", [name, at, id]);
    await d.run("UPDATE entities SET updated_at = ? WHERE id = ?", [at, id]);
  });
  emitChange();
};

// Delete a property set (C11): tombstone only. Its values become inert (`core.propertyValuesFor`
// filters them out) rather than being deleted themselves.
export const deletePropertySet = async (id: string): Promise<void> => {
  const d = await driver();
  const at = now();
  await d.run("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?", [at, at, id]);
  emitChange();
};

// The live value row for (setId, targetId), if any — a value is "one per set per target" in the UI's
// usage (a message either carries this thread's "Chapter" value or it doesn't), so writes here upsert
// on that pair rather than accumulating rows; the schema itself allows more (a fresh `id` each time)
// for whichever future lens wants many values of the same set on one target.
const livePropertyValue = async (d: Driver, setId: string, targetId: string) => {
  const [row] = await d.all<{ id: string }>(
    "SELECT id FROM property_values WHERE set_id = ? AND target_id = ? AND removed_at IS NULL",
    [setId, targetId],
  );
  return row?.id ?? null;
};

// Set (create or update) a value on any entity (note, message, thread, link — `targetId` is generic).
export const setPropertyValue = async (setId: string, targetId: string, value: string | null = null): Promise<void> => {
  const d = await driver();
  const at = now();
  const existingId = await livePropertyValue(d, setId, targetId);
  if (existingId)
    await d.run("UPDATE property_values SET value = ?, updated_at = ? WHERE id = ?", [value, at, existingId]);
  else
    await d.run(
      "INSERT INTO property_values (id, set_id, target_id, value, created_at, updated_at, removed_at, rev) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
      [uuid(), setId, targetId, value, at, at],
    );
  emitChange();
};

// Remove a value from an entity (tombstone, per C11 — a value is never hard-deleted by a plain
// remove). A no-op if there's no live value for this (set, target) pair.
export const removePropertyValue = async (setId: string, targetId: string): Promise<void> => {
  const d = await driver();
  const at = now();
  const existingId = await livePropertyValue(d, setId, targetId);
  if (!existingId) return;
  await d.run("UPDATE property_values SET removed_at = ?, updated_at = ? WHERE id = ?", [at, at, existingId]);
  emitChange();
};

// --- connections (links) ------------------------------------------------------------------------

// Create a "connection" (docs/direction.md Decision 3: "A row between two entities, typed by a
// property value") — a `links` row is itself an entity (`kind = 'link'`, "Links have no kind
// column"), so a bare connection with no type yet is still a complete, valid row: typing it is a
// separate `setPropertyValue(setId, linkId, value)` call against the id this returns, same as any
// other entity ("optional typing" per the selection-menu flow). `pinVersionId` is left unset here —
// nothing (yet) creates a link pinned to a specific version of its target the way a cloned message
// pins to a note version.
export const createLink = async (fromId: string, toId: string): Promise<{ id: string }> => {
  const d = await driver();
  const at = now();
  const id = uuid();
  await d.tx(async () => {
    await insertEntity(d, id, "link", at);
    await d.run(
      "INSERT INTO links (id, from_id, to_id, pin_version_id, updated_at, rev) VALUES (?, ?, ?, NULL, ?, NULL)",
      [id, fromId, toId, at],
    );
  });
  emitChange();
  return { id };
};

// --- Settings > Dev: sample data and purge (local QA on an empty device) ----------------------

const CHUNK_ROWS = 300;

// Adds one more sample batch (core/seed.ts's `small` scale, dated relative to now). A fresh seed and id salt per
// call mean pressing again adds more rows and never reuses an id. Rows land pending (rev NULL), a transaction per
// CHUNK_ROWS rows in table (foreign-key) order, so a big batch never holds one huge statement list or freezes the UI.
export const addSampleData = async (onProgress?: (done: number, total: number) => void): Promise<number> => {
  const d = await driver();
  const salt = 1 + Math.floor(Math.random() * 0xfffffffe);
  const all = generateSeed({ counts: SCALES.small, seed: salt, now: Date.now(), salt });
  const total = TABLE_NAMES.reduce((n, t) => n + all[t].length, 0);
  let done = 0;
  for (const table of TABLE_NAMES)
    for (let i = 0; i < all[table].length; i += CHUNK_ROWS) {
      const rows = all[table].slice(i, i + CHUNK_ROWS);
      await applyChanges(d, { [table]: rows } as Partial<Changes>);
      done += rows.length;
      onProgress?.(done, total);
    }
  emitChange();
  return total;
};

// Deletes every synced row on this device (children before parents) and puts the built-in property sets back,
// exactly as opening the database does. Device settings live in localStorage and are untouched. The caller resets
// the sync cursor (syncEngine.resetSync) so the next pull starts from rev 0.
export const purgeDatabase = async (): Promise<void> => {
  const d = await driver();
  await d.tx(async () => {
    for (const table of [...TABLE_NAMES].reverse()) await d.run(`DELETE FROM ${table}`);
    await d.run("DELETE FROM core_state");
  });
  await initSchema(d);
  await clearImages();
  emitChange();
};

export const liveCounts = async (): Promise<{ threads: number; notes: number }> => {
  const d = await driver();
  const [r] = await d.all<{ threads: number; notes: number }>(
    `SELECT COUNT(*) FILTER (WHERE kind = 'thread') AS threads, COUNT(*) FILTER (WHERE kind = 'note') AS notes
     FROM entities WHERE deleted_at IS NULL`,
  );
  return { threads: r?.threads ?? 0, notes: r?.notes ?? 0 };
};

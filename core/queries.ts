import { displayOrder, orderedMessageIds } from "./merge";
import { BUILTIN } from "./schema";
import type {
  Driver,
  EntityKind,
  LinkRow,
  MessageRow,
  NoteVersionRow,
  PropertySetRow,
  PropertyValueRow,
  ValueType,
} from "./schema";

// The read side of "one database, many lenses" (docs/direction.md, "Lenses"). Every function here is a
// query, not a view: it returns plain rows (or rows joined just enough to be useful), never a UI view model.
// The frontend/backend decide how to render them.

// A note's live-or-pinned content: `pin_version_id` null means "follow the latest version" (newest
// `created_at`, ties broken by id, per "Versions" in docs/direction.md); otherwise it's that exact version.
// As SQL, so a lens reads every row's version in one statement instead of one worker round trip per row (each is
// a postMessage hop on the phone). Join it as
// `LEFT JOIN note_versions v ON v.id = ${versionIdOf(pin, note)}` and select `VERSION_COLS`.
const versionIdOf = (pin: string, note: string) =>
  `COALESCE((SELECT id FROM note_versions WHERE id = ${pin}),
     (SELECT id FROM note_versions WHERE note_id = ${note} ORDER BY created_at DESC, id DESC LIMIT 1))`;
const VERSION_COLS = `v.id AS v_id, v.note_id AS v_note_id, v.parent_id AS v_parent_id, v.content AS v_content,
  v.author AS v_author, v.created_at AS v_created_at, v.rev AS v_rev`;
type VersionCols = {
  v_id: string | null;
  v_note_id: string;
  v_parent_id: string | null;
  v_content: string;
  v_author: NoteVersionRow["author"];
  v_created_at: number;
  v_rev: number | null;
};
const versionOf = (r: VersionCols, noteId: string): NoteVersionRow => {
  if (r.v_id === null) throw new Error(`note ${noteId} has no versions`);
  return {
    id: r.v_id,
    note_id: r.v_note_id,
    parent_id: r.v_parent_id,
    content: r.v_content,
    author: r.v_author,
    created_at: r.v_created_at,
    rev: r.v_rev,
  };
};

export type ThreadListRow = { id: string; title: string; created_at: number; updated_at: number };

// Every live thread, newest-updated first. Not in the original frozen query set (direction.md's
// lenses don't name a plain "list all threads" query) but every list-style UI needs one, so it's
// added here per the note in that file: "core/queries.ts is yours to extend, not just consume."
export const listThreads = async (d: Driver): Promise<ThreadListRow[]> =>
  d.all<ThreadListRow>(
    `SELECT t.id, t.title, e.created_at, t.updated_at FROM threads t
     JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL
     ORDER BY t.updated_at DESC`,
  );

export type ThreadViewRow = { message: MessageRow; version: NoteVersionRow };

type ThreadRowCols = MessageRow & VersionCols & { entity_created_at: number };

const splitMessage = (r: ThreadRowCols): ThreadViewRow => {
  const { v_id, v_note_id, v_parent_id, v_content, v_author, v_created_at, v_rev, entity_created_at, ...message } = r;
  return { message, version: versionOf(r, r.note_id) };
};

// Which messages a load covers: one thread, or every message of every live thread.
type Scope = { messages: string; params: string[] };
const ONE = (threadId: string): Scope => ({ messages: "m.thread_id = ?", params: [threadId] });
const ALL: Scope = {
  messages: "m.thread_id IN (SELECT t.id FROM threads t JOIN entities te ON te.id = t.id WHERE te.deleted_at IS NULL)",
  params: [],
};

// Live messages with their live-or-pinned version (one statement, creation order), then each thread's rows put
// into display order with `displayOrder`.
const loadMessages = async (d: Driver, scope: Scope): Promise<Map<string, ThreadRowCols[]>> => {
  const rows = await d.all<ThreadRowCols>(
    `SELECT m.*, e.created_at AS entity_created_at, ${VERSION_COLS}
     FROM messages m
     JOIN entities e ON e.id = m.id
     LEFT JOIN note_versions v ON v.id = ${versionIdOf("m.pin_version_id", "m.note_id")}
     WHERE ${scope.messages} AND m.removed_at IS NULL AND e.deleted_at IS NULL
     ORDER BY e.created_at, m.id`,
    scope.params,
  );
  const orders = await d.all<{ thread_id: string; message_ids: string }>(
    `SELECT thread_id, message_ids FROM thread_order ${scope === ALL ? "" : "WHERE thread_id = ?"}`,
    scope === ALL ? [] : scope.params,
  );
  const stored = new Map(orders.map((o) => [o.thread_id, o.message_ids]));
  const byThread = new Map<string, ThreadRowCols[]>();
  for (const r of rows) {
    const list = byThread.get(r.thread_id);
    if (list) list.push(r);
    else byThread.set(r.thread_id, [r]);
  }
  for (const [threadId, list] of byThread) {
    const byId = new Map(list.map((r) => [r.id, r]));
    byThread.set(
      threadId,
      displayOrder(
        list.map((r) => r.id),
        stored.get(threadId),
      ).flatMap((id) => byId.get(id) ?? []),
    );
  }
  return byThread;
};

// Thread view (chat and line mode share this query; they only differ in the view). A thread's messages in
// display order (`displayOrder`), each joined to its note's live-or-pinned version.
export const threadView = async (d: Driver, threadId: string): Promise<ThreadViewRow[]> =>
  ((await loadMessages(d, ONE(threadId))).get(threadId) ?? []).map(splitMessage);

export type ThreadEntry = ThreadViewRow & {
  /** The message entity's `created_at` (when it was placed). */
  created_at: number;
  /** The note's other versions, oldest first. */
  edits: { content: string; created_at: number }[];
  /** Newest version's `created_at` when the note has any version besides the shown one. */
  edited_at: number | null;
  todo: { done: number; updated_at: number } | null;
};

const entries = async (d: Driver, scope: Scope): Promise<Map<string, ThreadEntry[]>> => {
  const loaded = await loadMessages(d, scope);
  const versions = await d.all<{ note_id: string; id: string; content: string; created_at: number }>(
    `SELECT note_id, id, content, created_at FROM note_versions
     WHERE note_id IN (SELECT m.note_id FROM messages m WHERE ${scope.messages} AND m.removed_at IS NULL)
     ORDER BY created_at, id`,
    scope.params,
  );
  const todoRows = await d.all<{ target_id: string; done: number; updated_at: number }>(
    `SELECT target_id, done, updated_at FROM todos WHERE target_id IN (SELECT m.id FROM messages m WHERE ${scope.messages})`,
    scope.params,
  );
  const byNote = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = byNote.get(v.note_id);
    if (list) list.push(v);
    else byNote.set(v.note_id, [v]);
  }
  const todoOf = new Map(todoRows.map((t) => [t.target_id, { done: t.done, updated_at: t.updated_at }]));
  const out = new Map<string, ThreadEntry[]>();
  for (const [threadId, rows] of loaded)
    out.set(
      threadId,
      rows.map((r) => {
        const view = splitMessage(r);
        const history = byNote.get(r.note_id) ?? [];
        const edits = history.filter((v) => v.id !== view.version.id);
        return {
          ...view,
          created_at: r.entity_created_at,
          edits: edits.map((v) => ({ content: v.content, created_at: v.created_at })),
          edited_at: edits.length ? (history.at(-1)?.created_at ?? null) : null,
          todo: todoOf.get(r.id) ?? null,
        };
      }),
    );
  return out;
};

// `threadView` plus what the thread screen shows per message (placement time, edit history, todo flag): four
// statements however long the thread is.
export const threadEntries = async (d: Driver, threadId: string): Promise<ThreadEntry[]> =>
  (await entries(d, ONE(threadId))).get(threadId) ?? [];

// Every live thread's `threadEntries`, keyed by thread id: four statements for the whole database. For scans
// that read all of it (reference autocomplete, image GC).
export const allEntries = (d: Driver): Promise<Map<string, ThreadEntry[]>> => entries(d, ALL);

export type PoolNoteRow = { entity_id: string; created_at: number; version: NoteVersionRow };

type NoteVersionCols = { entity_id: string; created_at: number } & VersionCols;

const NOTE_WITH_VERSION = `SELECT e.id AS entity_id, e.created_at, ${VERSION_COLS}
  FROM entities e LEFT JOIN note_versions v ON v.id = ${versionIdOf("NULL", "e.id")}`;

const poolNote = (r: NoteVersionCols): PoolNoteRow => ({
  entity_id: r.entity_id,
  created_at: r.created_at,
  version: versionOf(r, r.entity_id),
});

// Pool: notes with no live message (no un-removed message, on a non-deleted entity, pointing at the note).
export const pool = async (d: Driver): Promise<PoolNoteRow[]> =>
  (
    await d.all<NoteVersionCols>(
      `${NOTE_WITH_VERSION}
       WHERE e.kind = 'note' AND e.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM messages m JOIN entities me ON me.id = m.id
           WHERE m.note_id = e.id AND m.removed_at IS NULL AND me.deleted_at IS NULL
         )
       ORDER BY e.created_at DESC`,
    )
  ).map(poolNote);

// Every live note, one row each however many messages place it (a note in two threads is still one
// note): the `[[` autocomplete's note candidates. `pool` above is the unplaced subset.
export const allNotes = async (d: Driver): Promise<PoolNoteRow[]> =>
  (
    await d.all<NoteVersionCols>(
      `${NOTE_WITH_VERSION} WHERE e.kind = 'note' AND e.deleted_at IS NULL ORDER BY e.created_at DESC`,
    )
  ).map(poolNote);

export type TodoContext =
  | { kind: "message"; thread_id: string; note_content: string }
  | { kind: Exclude<EntityKind, "message"> };

export type TodoRowView = { target_id: string; done: number; updated_at: number; kind: EntityKind; context: TodoContext };

// Todos: entities with a `todos` row (docs/direction.md's `/todo` lines are parsed from text on the
// frontend, not core's job). Joined to just enough context to render one: a message's thread and its note's
// live content.
export const todos = async (d: Driver): Promise<TodoRowView[]> => {
  const rows = await d.all<
    {
      target_id: string;
      done: number;
      updated_at: number;
      kind: EntityKind;
      thread_id: string | null;
      note_id: string | null;
    } & VersionCols
  >(
    `SELECT t.target_id, t.done, t.updated_at, e.kind, m.thread_id, m.note_id, ${VERSION_COLS}
     FROM todos t
     JOIN entities e ON e.id = t.target_id
     LEFT JOIN messages m ON m.id = t.target_id
     LEFT JOIN note_versions v ON v.id = ${versionIdOf("m.pin_version_id", "m.note_id")}
     WHERE e.deleted_at IS NULL
     ORDER BY t.updated_at DESC`,
  );
  const out: TodoRowView[] = [];
  for (const r of rows) {
    const base = { target_id: r.target_id, done: r.done, updated_at: r.updated_at };
    if (r.kind !== "message") out.push({ ...base, kind: r.kind, context: { kind: r.kind } });
    else if (r.thread_id !== null && r.note_id !== null)
      out.push({
        ...base,
        kind: r.kind,
        context: { kind: "message", thread_id: r.thread_id, note_content: versionOf(r, r.note_id).content },
      });
  }
  return out;
};

export type BinRow = { id: string; kind: EntityKind; deleted_at: number };

// Bin: entities with `deleted_at` set, across all kinds, newest deletion first.
export const bin = async (d: Driver): Promise<BinRow[]> =>
  d.all<BinRow>(
    "SELECT id, kind, deleted_at FROM entities WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
  );

export type SearchNoteHit = { kind: "note"; entity_id: string; version: NoteVersionRow };
export type SearchThreadHit = { kind: "thread"; thread_id: string; title: string };
export type SearchHit = SearchNoteHit | SearchThreadHit;

// Search (lite): a plain LIKE substring search over the latest version content of live notes and over live
// thread titles. Placeholder ahead of FTS5 wiring (backend/phone specific, out of scope here). Scans each
// live note's newest version once (not every historical version), and reads the hits' versions in the same
// statement.
export const search = async (d: Driver, query: string): Promise<SearchHit[]> => {
  const like = `%${query}%`;
  const noteRows = await d.all<NoteVersionCols>(
    `${NOTE_WITH_VERSION} WHERE e.kind = 'note' AND e.deleted_at IS NULL AND v.content LIKE ?`,
    [like],
  );
  const notes: SearchHit[] = noteRows.map((r) => ({
    kind: "note",
    entity_id: r.entity_id,
    version: versionOf(r, r.entity_id),
  }));
  const threadRows = await d.all<{ id: string; title: string }>(
    `SELECT t.id, t.title FROM threads t JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL AND t.title LIKE ?`,
    [like],
  );
  const threads: SearchHit[] = threadRows.map((t) => ({ kind: "thread", thread_id: t.id, title: t.title }));
  return [...notes, ...threads];
};

// The threads a search reaches, as ids: live threads currently placing a note whose newest version matches,
// then live threads whose title matches, each once. Two statements however many hits (`search` followed by a
// lookup per matching note was a worker round trip per hit).
export const searchThreadIds = async (d: Driver, query: string): Promise<string[]> => {
  const like = `%${query}%`;
  const byNote = await d.all<{ id: string }>(
    `SELECT DISTINCT m.thread_id AS id FROM entities ne
     JOIN note_versions v ON v.id = (SELECT id FROM note_versions WHERE note_id = ne.id ORDER BY created_at DESC, id DESC LIMIT 1)
     JOIN messages m ON m.note_id = ne.id AND m.removed_at IS NULL
     JOIN entities me ON me.id = m.id AND me.deleted_at IS NULL
     JOIN entities te ON te.id = m.thread_id AND te.deleted_at IS NULL
     WHERE ne.kind = 'note' AND ne.deleted_at IS NULL AND v.content LIKE ?`,
    [like],
  );
  const byTitle = await d.all<{ id: string }>(
    "SELECT t.id FROM threads t JOIN entities e ON e.id = t.id WHERE e.deleted_at IS NULL AND t.title LIKE ?",
    [like],
  );
  return [...new Set([...byNote, ...byTitle].map((r) => r.id))];
};

export type OtherThreadRow = { message_id: string; thread_id: string; thread_title: string };

// Gutter mark "other threads" (docs/direction.md "Lenses": "per message: other threads its note is
// in"): every other live message placing the same note, resolved to its thread — a note can be
// placed in more than one thread (docs/direction.md "One home or many": "A message is that note
// placed in a thread"), so this is what makes those other placements visible from any one of them.
// `excludeMessageId` drops the message the caller is already looking at.
export const otherThreadsForNote = async (
  d: Driver,
  noteId: string,
  excludeMessageId?: string,
): Promise<OtherThreadRow[]> =>
  d.all<OtherThreadRow>(
    `SELECT m.id AS message_id, m.thread_id AS thread_id, t.title AS thread_title
     FROM messages m
     JOIN entities me ON me.id = m.id
     JOIN threads t ON t.id = m.thread_id
     JOIN entities te ON te.id = t.id
     WHERE m.note_id = ? AND m.removed_at IS NULL AND me.deleted_at IS NULL AND te.deleted_at IS NULL
       ${excludeMessageId ? "AND m.id != ?" : ""}
     ORDER BY m.updated_at DESC`,
    excludeMessageId ? [noteId, excludeMessageId] : [noteId],
  );

export type LinkWithType = { link: LinkRow; type_value: PropertyValueRow | null };

// Links for an entity: its outgoing and incoming links (not deleted — a link is a `link`-kind entity, so
// "not deleted" means the link's own entity row has no `deleted_at`), each resolved to its "type" property
// value if it has one. A link's type is a property value on the link itself (`property_values.target_id` =
// the link's id) per "Links have no kind column" in docs/direction.md; a link can in principle carry more
// than one property value (there's no single "the type set" flagged in the spec), so this returns the
// single live value with the lowest `created_at` as a best-effort "the type", and leaves picking a
// different one up to the caller if that guess is wrong for a given property set. Flagging this rather than
// guessing further: resolving "the type" cleanly would need a designated type-property-set id, which isn't
// in the schema yet.
export const linksFor = async (d: Driver, entityId: string): Promise<{ outgoing: LinkWithType[]; incoming: LinkWithType[] }> => {
  const typeFor = async (linkId: string): Promise<PropertyValueRow | null> => {
    const [v] = await d.all<PropertyValueRow>(
      "SELECT * FROM property_values WHERE target_id = ? AND removed_at IS NULL ORDER BY created_at, id LIMIT 1",
      [linkId],
    );
    return v ?? null;
  };
  const load = async (sql: string) => {
    const rows = await d.all<LinkRow>(sql, [entityId]);
    const out: LinkWithType[] = [];
    for (const link of rows) out.push({ link, type_value: await typeFor(link.id) });
    return out;
  };
  const outgoing = await load(
    `SELECT l.* FROM links l JOIN entities e ON e.id = l.id WHERE l.from_id = ? AND e.deleted_at IS NULL`,
  );
  const incoming = await load(
    `SELECT l.* FROM links l JOIN entities e ON e.id = l.id WHERE l.to_id = ? AND e.deleted_at IS NULL`,
  );
  return { outgoing, incoming };
};

export type PropertyValueView = {
  value: PropertyValueRow;
  set: { id: string; name: string; value_type: ValueType; color_slot: number | null };
};

// Property values for an entity: its live values joined to their property_set — skipping any whose set is
// itself tombstoned (docs/direction.md "Round 5 C11": "property values under a deleted set become inert —
// no chip renders, not deleted themselves"). A set is a `property_set`-kind entity, so "deleted" means its
// own `entities.deleted_at`, not `property_values.removed_at` (that's the value's own tombstone).
export const propertyValuesFor = async (d: Driver, entityId: string): Promise<PropertyValueView[]> => {
  const rows = await d.all<{
    id: string;
    set_id: string;
    target_id: string;
    value: string | null;
    created_at: number;
    updated_at: number;
    removed_at: number | null;
    rev: number | null;
    set_name: string;
    value_type: ValueType;
    color_slot: number | null;
  }>(
    `SELECT pv.*, ps.name AS set_name, ps.value_type AS value_type, ps.color_slot AS color_slot
     FROM property_values pv
     JOIN property_sets ps ON ps.id = pv.set_id
     JOIN entities se ON se.id = ps.id
     WHERE pv.target_id = ? AND pv.removed_at IS NULL AND se.deleted_at IS NULL
     ORDER BY pv.created_at`,
    [entityId],
  );
  return rows.map((r) => ({
    value: {
      id: r.id,
      set_id: r.set_id,
      target_id: r.target_id,
      value: r.value,
      created_at: r.created_at,
      updated_at: r.updated_at,
      removed_at: r.removed_at,
      rev: r.rev,
    },
    set: { id: r.set_id, name: r.set_name, value_type: r.value_type, color_slot: r.color_slot },
  }));
};

// Property sets available to use: every live global set (`scope_thread_id IS NULL`), plus — when a thread
// is given — that thread's own scoped sets too (docs/direction.md "C13": "scope: global vs one thread").
// Built-in sets (docs/direction.md "Links have no kind column") come back here like any other live set;
// callers that don't want to offer them for manual attachment (e.g. the Settings list, the message ⋯
// menu's "Add property" picker) filter on id against `BUILTIN`.
export const propertySets = async (d: Driver, threadId?: string): Promise<PropertySetRow[]> =>
  d.all<PropertySetRow>(
    `SELECT ps.* FROM property_sets ps
     JOIN entities e ON e.id = ps.id
     WHERE e.deleted_at IS NULL AND (ps.scope_thread_id IS NULL${threadId ? " OR ps.scope_thread_id = ?" : ""})
     ORDER BY ps.name`,
    threadId ? [threadId] : [],
  );

// The `counter` rule (docs/direction.md "Rules are computed, not stored"): a set in `counter` mode numbers
// only the messages that carry a live value under it, by their position in that thread's display order
// (`orderedMessageIds`) — not the thread's absolute position, so unrelated messages in between don't break
// the count. Returns null when the set isn't a counter, the message isn't in a thread, or it isn't a member.
export const counterValue = async (d: Driver, setId: string, messageId: string): Promise<number | null> => {
  const [set] = await d.all<Pick<PropertySetRow, "rule">>("SELECT rule FROM property_sets WHERE id = ?", [setId]);
  if (!set || set.rule !== "counter") return null;
  const [msg] = await d.all<Pick<MessageRow, "thread_id">>("SELECT thread_id FROM messages WHERE id = ?", [
    messageId,
  ]);
  if (!msg) return null;
  const members = await d.all<{ target_id: string }>(
    "SELECT target_id FROM property_values WHERE set_id = ? AND removed_at IS NULL",
    [setId],
  );
  const memberIds = new Set(members.map((m) => m.target_id));
  const ordered = (await orderedMessageIds(d, msg.thread_id)).filter((id) => memberIds.has(id));
  const index = ordered.indexOf(messageId);
  return index >= 0 ? index + 1 : null;
};

// Whether a *pinned* reference (`tz:note/<id>@<version>`, docs/direction.md "C14") to `noteId` is
// stale: the note has moved on to a newer version since the reference was pinned ("Versions": "the
// latest version is the one with the newest `created_at`, ties broken by id"). A note with no
// versions at all (shouldn't happen for a live note, but nothing here assumes it can't) isn't
// "stale" — there's nothing to compare the pin against, so this reads false rather than throwing.
export const isReferenceStale = async (d: Driver, noteId: string, pinnedVersionId: string): Promise<boolean> => {
  const [latest] = await d.all<{ id: string }>(
    "SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [noteId],
  );
  return latest ? latest.id !== pinnedVersionId : false;
};

// `isReferenceStale` for a bare pinned version id (the note is looked up from it).
export const isPinStale = async (d: Driver, pinVersionId: string): Promise<boolean> => {
  const [v] = await d.all<{ note_id: string }>("SELECT note_id FROM note_versions WHERE id = ?", [pinVersionId]);
  return v ? isReferenceStale(d, v.note_id, pinVersionId) : false;
};

// SQL scalar subselect: the latest version's content of the note whose id is `noteIdExpr`.
export const latestContentSql = (noteIdExpr: string) =>
  `(SELECT content FROM note_versions v WHERE v.note_id = ${noteIdExpr} ORDER BY v.created_at DESC, v.id DESC LIMIT 1)`;

export type LinkCandidate = { id: string; label: string; updated_at: number };

// Every live link, newest-updated first, each labelled with its best-effort "type" property value
// (same single-lowest-`created_at`-value heuristic `linksFor`'s `typeFor` uses — a link has no name
// of its own, docs/direction.md "Links have no kind column"). For the `[[` reference autocomplete's
// "any link" candidates (lib/references.ts); not in the original frozen query set, same "core/queries.ts
// is yours to extend" note `listThreads` above already leans on.
export const listLinks = async (d: Driver): Promise<LinkCandidate[]> => {
  const rows = await d.all<LinkRow>(
    `SELECT l.* FROM links l JOIN entities e ON e.id = l.id WHERE e.deleted_at IS NULL ORDER BY l.updated_at DESC`,
  );
  const out: LinkCandidate[] = [];
  for (const link of rows) {
    const [v] = await d.all<PropertyValueRow>(
      "SELECT * FROM property_values WHERE target_id = ? AND removed_at IS NULL ORDER BY created_at, id LIMIT 1",
      [link.id],
    );
    out.push({ id: link.id, label: v?.value ?? "Link", updated_at: link.updated_at });
  }
  return out;
};

export type AttachedNoteRow = { link: LinkRow; message_id: string; note_id: string; version: NoteVersionRow };

// Attached notes for a whole thread (docs/direction.md "Links have no kind column"): a note attached to a
// message is a note plus a link carrying the built-in `attached` property value, replacing v1's dedicated
// `annotations` table. One flat array across every live message in the thread, each resolved to its note's
// live-or-pinned version — batched against the thread's live message ids in one query, rather than calling
// `linksFor` per message (N+1). "Live" here means both the link's own entity and the note's entity have no
// `deleted_at` (delete tombstones both, per "Round 5 C11").
export const annotationsFor = async (d: Driver, threadId: string): Promise<AttachedNoteRow[]> => {
  const rows = await d.all<LinkRow & VersionCols>(
    `SELECT l.*, ${VERSION_COLS} FROM links l
     JOIN entities le ON le.id = l.id
     JOIN entities ne ON ne.id = l.from_id
     JOIN property_values pv ON pv.target_id = l.id AND pv.set_id = ? AND pv.removed_at IS NULL
     LEFT JOIN note_versions v ON v.id = ${versionIdOf("l.pin_version_id", "l.from_id")}
     WHERE l.to_id IN (
         SELECT m.id FROM messages m JOIN entities me ON me.id = m.id
         WHERE m.thread_id = ? AND m.removed_at IS NULL AND me.deleted_at IS NULL)
       AND le.deleted_at IS NULL AND ne.deleted_at IS NULL`,
    [BUILTIN.attached, threadId],
  );
  return rows.map((r) => {
    const { v_id, v_note_id, v_parent_id, v_content, v_author, v_created_at, v_rev, ...link } = r;
    return { link, message_id: link.to_id, note_id: link.from_id, version: versionOf(r, link.from_id) };
  });
};

// Pinned references (`pin_version_id`) whose note has since gained a newer version: the "stale" test of
// `isReferenceStale` as a join condition, for a `note_versions pv` row that is the pinned version.
export const STALE_PIN_SQL = "pv.id != (SELECT id FROM note_versions WHERE note_id = pv.note_id ORDER BY created_at DESC, id DESC LIMIT 1)";

export type TodoScanRow = {
  id: string;
  thread_id: string;
  content: string;
  /** The message entity's `created_at`. */
  created_at: number;
  /** Newest version's `created_at`, when the note has a version besides the shown one. */
  edited_at: number | null;
  todo: { done: number; updated_at: number } | null;
};

// The messages the Todos lens has to read: every live message in a live thread that carries a `todos` row or
// whose text could hold a `/todo` command, `/todos` group or `[ ]` checkbox line (a superset of what
// `lib/todos.ts` parses; the parser stays the judge). One statement for the whole database, where reading
// every message of every thread was a few worker round trips each. Threads newest-updated first.
export const todoScan = async (d: Driver): Promise<TodoScanRow[]> => {
  const rows = await d.all<{
    id: string;
    thread_id: string;
    content: string | null;
    created_at: number;
    edited_at: number | null;
    todo_done: number | null;
    todo_updated_at: number | null;
  }>(
    `SELECT m.id, m.thread_id, v.content, e.created_at, td.done AS todo_done, td.updated_at AS todo_updated_at,
       CASE WHEN EXISTS (SELECT 1 FROM note_versions x WHERE x.note_id = m.note_id AND x.id != v.id)
         THEN (SELECT MAX(created_at) FROM note_versions x WHERE x.note_id = m.note_id) END AS edited_at
     FROM messages m
     JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL
     JOIN threads t ON t.id = m.thread_id
     JOIN entities te ON te.id = t.id AND te.deleted_at IS NULL
     LEFT JOIN note_versions v ON v.id = ${versionIdOf("m.pin_version_id", "m.note_id")}
     LEFT JOIN todos td ON td.target_id = m.id
     WHERE m.removed_at IS NULL
       AND (td.target_id IS NOT NULL OR v.content LIKE '%todo%' OR v.content LIKE '%[ %' OR v.content LIKE '%[]%'
            OR v.content LIKE '%[x%' OR v.content LIKE '%[' || char(9) || '%')
     ORDER BY t.updated_at DESC, t.id, e.created_at, m.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    content: r.content ?? "",
    created_at: r.created_at,
    edited_at: r.edited_at,
    todo: r.todo_done === null ? null : { done: r.todo_done, updated_at: r.todo_updated_at ?? 0 },
  }));
};

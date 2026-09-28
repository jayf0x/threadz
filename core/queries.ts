import { orderedMessageIds } from "./merge";
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
const resolveVersion = async (d: Driver, noteId: string, pinVersionId: string | null): Promise<NoteVersionRow> => {
  if (pinVersionId) {
    const [v] = await d.all<NoteVersionRow>("SELECT * FROM note_versions WHERE id = ?", [pinVersionId]);
    if (v) return v;
  }
  const [v] = await d.all<NoteVersionRow>(
    "SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [noteId],
  );
  if (!v) throw new Error(`note ${noteId} has no versions`);
  return v;
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

// Thread view (chat and line mode share this query; they only differ in the view). A thread's messages in
// display order (`orderedMessageIds`), each joined to its note's live-or-pinned version.
export const threadView = async (d: Driver, threadId: string): Promise<ThreadViewRow[]> => {
  const ids = await orderedMessageIds(d, threadId);
  const out: ThreadViewRow[] = [];
  for (const id of ids) {
    const [message] = await d.all<MessageRow>("SELECT * FROM messages WHERE id = ?", [id]);
    if (!message) continue;
    out.push({ message, version: await resolveVersion(d, message.note_id, message.pin_version_id) });
  }
  return out;
};

export type PoolNoteRow = { entity_id: string; created_at: number; version: NoteVersionRow };

// Pool: notes with no live message (no un-removed message, on a non-deleted entity, pointing at the note).
export const pool = async (d: Driver): Promise<PoolNoteRow[]> => {
  const notes = await d.all<{ id: string; created_at: number }>(
    `SELECT e.id, e.created_at FROM entities e
     WHERE e.kind = 'note' AND e.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM messages m JOIN entities me ON me.id = m.id
         WHERE m.note_id = e.id AND m.removed_at IS NULL AND me.deleted_at IS NULL
       )
     ORDER BY e.created_at DESC`,
  );
  const out: PoolNoteRow[] = [];
  for (const n of notes) out.push({ entity_id: n.id, created_at: n.created_at, version: await resolveVersion(d, n.id, null) });
  return out;
};

export type TodoContext =
  | { kind: "message"; thread_id: string; note_content: string }
  | { kind: Exclude<EntityKind, "message"> };

export type TodoRowView = { target_id: string; done: number; updated_at: number; kind: EntityKind; context: TodoContext };

// Todos: entities with a `todos` row (docs/direction.md's `/todo` lines are parsed from text on the
// frontend, not core's job). Joined to just enough context to render one: a message's thread and its note's
// live content.
export const todos = async (d: Driver): Promise<TodoRowView[]> => {
  const rows = await d.all<{ target_id: string; done: number; updated_at: number; kind: EntityKind }>(
    `SELECT t.target_id, t.done, t.updated_at, e.kind FROM todos t
     JOIN entities e ON e.id = t.target_id
     WHERE e.deleted_at IS NULL
     ORDER BY t.updated_at DESC`,
  );
  const out: TodoRowView[] = [];
  for (const r of rows) {
    if (r.kind === "message") {
      const [m] = await d.all<MessageRow>("SELECT * FROM messages WHERE id = ?", [r.target_id]);
      if (!m) continue;
      const version = await resolveVersion(d, m.note_id, m.pin_version_id);
      out.push({
        target_id: r.target_id,
        done: r.done,
        updated_at: r.updated_at,
        kind: r.kind,
        context: { kind: "message", thread_id: m.thread_id, note_content: version.content },
      });
    } else {
      out.push({ target_id: r.target_id, done: r.done, updated_at: r.updated_at, kind: r.kind, context: { kind: r.kind } });
    }
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
// thread titles. Placeholder ahead of FTS5 wiring (backend/phone specific, out of scope here).
export const search = async (d: Driver, query: string): Promise<SearchHit[]> => {
  const like = `%${query}%`;
  const noteRows = await d.all<{ id: string }>(
    `SELECT DISTINCT e.id FROM entities e
     JOIN note_versions v ON v.note_id = e.id
     WHERE e.kind = 'note' AND e.deleted_at IS NULL AND v.content LIKE ?
       AND v.created_at = (SELECT MAX(v2.created_at) FROM note_versions v2 WHERE v2.note_id = e.id)`,
    [like],
  );
  const notes: SearchHit[] = [];
  for (const n of noteRows) notes.push({ kind: "note", entity_id: n.id, version: await resolveVersion(d, n.id, null) });
  const threadRows = await d.all<{ id: string; title: string }>(
    `SELECT t.id, t.title FROM threads t JOIN entities e ON e.id = t.id
     WHERE e.deleted_at IS NULL AND t.title LIKE ?`,
    [like],
  );
  const threads: SearchHit[] = threadRows.map((t) => ({ kind: "thread", thread_id: t.id, title: t.title }));
  return [...notes, ...threads];
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

export type AttachedNoteRow = { link: LinkRow; message_id: string; note_id: string; version: NoteVersionRow };

// Attached notes for a whole thread (docs/direction.md "Links have no kind column"): a note attached to a
// message is a note plus a link carrying the built-in `attached` property value, replacing v1's dedicated
// `annotations` table. One flat array across every live message in the thread, each resolved to its note's
// live-or-pinned version — batched against the thread's live message ids in one query, rather than calling
// `linksFor` per message (N+1). "Live" here means both the link's own entity and the note's entity have no
// `deleted_at` (delete tombstones both, per "Round 5 C11").
export const annotationsFor = async (d: Driver, threadId: string): Promise<AttachedNoteRow[]> => {
  const messageIds = await orderedMessageIds(d, threadId);
  if (!messageIds.length) return [];
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = await d.all<LinkRow>(
    `SELECT l.* FROM links l
     JOIN entities le ON le.id = l.id
     JOIN entities ne ON ne.id = l.from_id
     JOIN property_values pv ON pv.target_id = l.id AND pv.set_id = ? AND pv.removed_at IS NULL
     WHERE l.to_id IN (${placeholders}) AND le.deleted_at IS NULL AND ne.deleted_at IS NULL`,
    [BUILTIN.attached, ...messageIds],
  );
  const out: AttachedNoteRow[] = [];
  for (const link of rows)
    out.push({ link, message_id: link.to_id, note_id: link.from_id, version: await resolveVersion(d, link.from_id, link.pin_version_id) });
  return out;
};

import { orderedMessageIds } from "./merge";
import type { Driver, EntityKind, LinkRow, MessageRow, NoteVersionRow, PropertyValueRow, ValueType } from "./schema";

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

// Property values for an entity: its live values joined to their property_set.
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
     FROM property_values pv JOIN property_sets ps ON ps.id = pv.set_id
     WHERE pv.target_id = ? AND pv.removed_at IS NULL
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

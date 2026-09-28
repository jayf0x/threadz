// v2 view-model types (docs/direction.md "Data model"). These are the shapes `lib/data.ts` hands
// to the UI — derived from `core`'s normalized rows (entities/note_versions/messages/…), not the
// rows themselves. Kept close to v1's `Thread`/`Message` shape on purpose: most consumers (EntryRow,
// lib/todos.ts, lib/versions.ts, lib/threadOrder.ts) need no change at all this way; the real
// per-lens rework (versions UI, links, property values, an `Annotation` replacement built on the
// `attached` link type) is out of scope here and belongs to a later step.

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

// A previous text of a message; `at` (when that text was written) identifies it. Same shape as v1's
// Version, backed now by `note_versions` rows instead of a `edits` JSON column.
export type Version = { content: string; at: number };

export type MessageMeta = { todo?: { done: boolean }; voice?: boolean } & Record<string, unknown>;

export type Message = {
  id: string; // message (placement) id
  threadId: string;
  role: "user" | "assistant"; // note_versions.author
  content: string; // live (or pinned) note_versions.content
  createdAt: number; // the message entity's created_at (when it was placed)
  seq: number; // position in `orderedMessageIds` — replaces v1's stored seq column
  meta: MessageMeta | null; // meta.todo mirrors the `todos` table; nothing else is wired yet
  editedAt?: number | null; // newest note_versions.created_at, if later than the note's first version
  edits?: Version[]; // earlier note_versions, oldest first
  metaEditedAt?: number | null; // todos.updated_at
};

// v2's replacement for a one-per-message note is an `attached` link (docs/direction.md "Links have
// no kind column"): a note entity plus a link carrying the built-in `attached` property value, not a
// dedicated table. `id` is the note's own entity id (mirrors `Message.id` being the placement id).
// Backed by `core.annotationsFor` (per-thread) via `lib/data.ts`.
export type Annotation = {
  id: string;
  threadId: string;
  messageId: string;
  content: string;
  createdAt: number;
  editedAt?: number | null;
  edits?: Version[];
};

// What `syncEngine.ts` reports: rows pending (not yet stamped with a `rev`) across every core table.
export type Unsynced = { pending: number };

// A property set (docs/direction.md "Data model"/"C13"): the *definition* of one kind of value —
// name, value type, scope (null = global, or one thread's id) and an optional computed `rule`.
// `colorSlot` is the palette slot (1-8) every chip on this set's values renders with.
export type PropertySet = {
  id: string;
  name: string;
  valueType: "none" | "text" | "number" | "date";
  scopeThreadId: string | null;
  rule: "counter" | null;
  colorSlot: number | null;
};

// One property value on an entity, joined to enough of its set to render a `Chip` (name + colour)
// without a second lookup. Backed by `core.propertyValuesFor`, which already excludes values whose
// set is tombstoned (inert, per "C11") and values that are themselves removed.
export type PropertyValue = {
  id: string;
  setId: string;
  setName: string;
  valueType: "none" | "text" | "number" | "date";
  colorSlot: number | null;
  targetId: string;
  value: string | null;
  createdAt: number;
};

// A "connection" (docs/direction.md Decision 3: "A row between two entities, typed by a property
// value") — a `links` row, joined to its "type" if it has one (the property value with the earliest
// `created_at` on the link's own entity id, per `core.linksFor`'s comment on why that's a
// best-effort pick rather than a designated "the type set"). `type` is `null` for an untyped link
// (a bare connection with no property value on it yet — still valid, just colourless).
export type Link = {
  id: string;
  fromId: string;
  toId: string;
  pinVersionId: string | null;
  updatedAt: number;
  type: { setId: string; setName: string; colorSlot: number | null; value: string | null } | null;
};

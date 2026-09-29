// The v2 data model (docs/direction.md, "Data model"). One schema for main (bun:sqlite) and the device
// (SQLite WASM): a note is raw content that belongs nowhere; a message is a note placed in a thread; links,
// property values and todos attach to any entity. Every table has `rev` (main's write counter; NULL = not
// on main yet). Mutable tables have `updated_at`, the last-write-wins clock; `note_versions` is immutable.

export type Param = string | number | null;

// The only thing core needs from a SQLite binding. Async: the device runs wa-sqlite's async build (needed
// for the IndexedDB VFS), so every query layer above this has to be async too. Main's bun:sqlite driver
// (core/bun.ts) just wraps its synchronous calls in resolved promises.
export type Driver = {
  run: (sql: string, params?: Param[]) => Promise<void>;
  all: <T>(sql: string, params?: Param[]) => Promise<T[]>;
  tx: <T>(fn: () => Promise<T>) => Promise<T>;
};

export const ENTITY_KINDS = ["note", "message", "thread", "link", "property_set"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const VALUE_TYPES = ["none", "text", "number", "date"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export type EntityRow = {
  id: string;
  kind: EntityKind;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  rev: number | null;
};
export type NoteVersionRow = {
  id: string;
  note_id: string;
  parent_id: string | null;
  content: string;
  author: "user" | "assistant";
  created_at: number;
  rev: number | null;
};
export type ThreadRow = { id: string; title: string; updated_at: number; rev: number | null };
export type MessageRow = {
  id: string;
  thread_id: string;
  note_id: string;
  pin_version_id: string | null;
  updated_at: number;
  removed_at: number | null;
  rev: number | null;
};
export type ThreadOrderRow = { thread_id: string; message_ids: string; updated_at: number; rev: number | null };
export type LinkRow = {
  id: string;
  from_id: string;
  to_id: string;
  pin_version_id: string | null;
  updated_at: number;
  rev: number | null;
};
export type PropertySetRow = {
  id: string;
  name: string;
  value_type: ValueType;
  scope_thread_id: string | null;
  rule: "counter" | null;
  color_slot: number | null;
  updated_at: number;
  rev: number | null;
};
export type PropertyValueRow = {
  id: string;
  set_id: string;
  target_id: string;
  value: string | null;
  created_at: number;
  updated_at: number;
  removed_at: number | null;
  rev: number | null;
};
export type TodoRow = { target_id: string; done: number; updated_at: number; rev: number | null };

// Everything that syncs, in foreign-key order (a row's parents come first).
export type Changes = {
  entities: EntityRow[];
  note_versions: NoteVersionRow[];
  threads: ThreadRow[];
  messages: MessageRow[];
  thread_order: ThreadOrderRow[];
  links: LinkRow[];
  property_sets: PropertySetRow[];
  property_values: PropertyValueRow[];
  todos: TodoRow[];
};
export type Table = keyof Changes;

// Primary key per table; `clock` null = immutable (insert-if-missing, only `rev` can be filled in).
export const TABLES: Record<Table, { pk: string; clock: "updated_at" | null }> = {
  entities: { pk: "id", clock: "updated_at" },
  note_versions: { pk: "id", clock: null },
  threads: { pk: "id", clock: "updated_at" },
  messages: { pk: "id", clock: "updated_at" },
  thread_order: { pk: "thread_id", clock: "updated_at" },
  links: { pk: "id", clock: "updated_at" },
  property_sets: { pk: "id", clock: "updated_at" },
  property_values: { pk: "id", clock: "updated_at" },
  todos: { pk: "target_id", clock: "updated_at" },
};
export const TABLE_NAMES = Object.keys(TABLES) as Table[];

// Built-in property sets: ordinary rows with fixed ids, identical on every database (rev 0 = known everywhere).
export const BUILTIN = {
  attached: "ps-attached", // on a link: its `from` note is a note attached to its `to` entity
  copiedFrom: "ps-copied-from", // on a link: `from` was copied out of `to`
  source: "ps-source", // on a note: how it was captured, e.g. "voice"
  localOnly: "ps-local-only", // on a thread: Ask is disabled for it (docs/direction.md "Round 6")
} as const;

const fk = (target: string) => `REFERENCES ${target} DEFERRABLE INITIALLY DEFERRED`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN (${ENTITY_KINDS.map((k) => `'${k}'`).join(",")})),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entities_kind_created ON entities(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_entities_deleted ON entities(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS note_versions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL ${fk("entities(id)")},
  parent_id  TEXT,
  content    TEXT NOT NULL,
  author     TEXT NOT NULL CHECK (author IN ('user','assistant')),
  created_at INTEGER NOT NULL,
  rev        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id, created_at);
CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY ${fk("entities(id)")},
  title      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY ${fk("entities(id)")},
  thread_id      TEXT NOT NULL ${fk("threads(id)")},
  note_id        TEXT NOT NULL ${fk("entities(id)")},
  pin_version_id TEXT,
  updated_at     INTEGER NOT NULL,
  removed_at     INTEGER,
  rev            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_note ON messages(note_id);
CREATE TABLE IF NOT EXISTS thread_order (
  thread_id   TEXT PRIMARY KEY ${fk("threads(id)")},
  message_ids TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  rev         INTEGER
);
CREATE TABLE IF NOT EXISTS links (
  id             TEXT PRIMARY KEY ${fk("entities(id)")},
  from_id        TEXT NOT NULL ${fk("entities(id)")},
  to_id          TEXT NOT NULL ${fk("entities(id)")},
  pin_version_id TEXT,
  updated_at     INTEGER NOT NULL,
  rev            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);
CREATE TABLE IF NOT EXISTS property_sets (
  id              TEXT PRIMARY KEY ${fk("entities(id)")},
  name            TEXT NOT NULL,
  value_type      TEXT NOT NULL CHECK (value_type IN (${VALUE_TYPES.map((t) => `'${t}'`).join(",")})),
  scope_thread_id TEXT,
  rule            TEXT CHECK (rule IN ('counter')),
  color_slot      INTEGER,
  updated_at      INTEGER NOT NULL,
  rev             INTEGER
);
CREATE TABLE IF NOT EXISTS property_values (
  id         TEXT PRIMARY KEY,
  set_id     TEXT NOT NULL ${fk("property_sets(id)")},
  target_id  TEXT NOT NULL ${fk("entities(id)")},
  value      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER,
  rev        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_values_target ON property_values(target_id);
CREATE INDEX IF NOT EXISTS idx_values_set ON property_values(set_id);
CREATE TABLE IF NOT EXISTS todos (
  target_id  TEXT PRIMARY KEY ${fk("entities(id)")},
  done       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev        INTEGER
);
${TABLE_NAMES.map((t) => `CREATE INDEX IF NOT EXISTS idx_pending_${t} ON ${t}(rev) WHERE rev IS NULL;`).join("\n")}
CREATE TABLE IF NOT EXISTS core_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

const BUILTIN_SETS: [id: string, name: string, type: ValueType][] = [
  [BUILTIN.attached, "Attached", "none"],
  [BUILTIN.copiedFrom, "Copied from", "none"],
  [BUILTIN.source, "Source", "text"],
  [BUILTIN.localOnly, "Local only", "none"],
];

// Migration 1 (core/migrate.ts): the whole schema, idempotent. No transaction of its own -- the runner supplies it.
export const applySchema = async (d: Driver) => {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim())) if (stmt) await d.run(stmt);
  for (const [id, name, type] of BUILTIN_SETS) {
    await d.run("INSERT OR IGNORE INTO entities VALUES (?, 'property_set', 0, 0, NULL, 0)", [id]);
    await d.run("INSERT OR IGNORE INTO property_sets VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0)", [id, name, type]);
  }
};

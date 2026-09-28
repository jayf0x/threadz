import { orderedMessageIds } from "./merge";
import { isReferenceStale } from "./queries";
import type { Driver } from "./schema";

// The computed map, "tracks" layout (docs/direction.md "Lenses": Map): every thread is a row, its live messages
// run left to right, and a note placed in several threads becomes a connector between those rows. A filter keeps
// only the matching messages (and so only the threads that still have any). The filter shape is a superset of
// what `core/insights.ts` puts in `Insight.source.filter` for `lens: "map"`, so a Home insight deep-links as-is.
// Weekday/hour buckets use UTC, like the insights that produce them.

export type MapFilter = {
  /** Note `created_at` range, inclusive. */
  from?: number;
  to?: number;
  /** UTC weekday, 0 = Sunday. */
  weekday?: number;
  /** UTC hour of day, 0-23. */
  hour?: number;
  /** A note or thread id: keep what is linked to it (either direction), and the entity itself. */
  linkedTo?: string;
  /** Property set (+ optional value; "" = a value-less/empty one) on the message, its note or its thread. */
  setA?: string;
  valueA?: string;
  /** A second set/value that has to sit on the same target as A. */
  setB?: string;
  valueB?: string;
  /** Pinned references whose note has since changed. */
  pinned?: "stale";
  /** Messages carrying a `todos` row (on the message or its note). */
  todo?: "open" | "done" | "any";
};

export type MapCell = {
  messageId: string;
  noteId: string;
  createdAt: number;
  preview: string;
  todo: "open" | "done" | null;
};
export type MapRow = { threadId: string; title: string; cells: MapCell[] };
export type MapConnector = {
  noteId: string;
  label: string;
  /** One entry per thread the note appears in, in row order. */
  stops: { row: number; cell: number }[];
};
export type MapTracks = { rows: MapRow[]; connectors: MapConnector[] };

export type MapFilterOptions = {
  properties: { setId: string; name: string; value: string }[];
  linkTargets: { id: string; kind: "note" | "thread"; label: string; n: number }[];
};

const NUMBER_KEYS = ["from", "to", "weekday", "hour"] as const;
const STRING_KEYS = ["linkedTo", "setA", "valueA", "setB", "valueB"] as const;
const TODO_VALUES = ["open", "done", "any"] as const;

/** Reads a filter from `/map?...` params. Unknown keys and malformed values are dropped, never thrown on. */
export const parseMapFilter = (search: string): MapFilter => {
  const params = new URLSearchParams(search);
  const out: MapFilter = {};
  for (const k of NUMBER_KEYS) {
    const raw = params.get(k);
    if (raw === null || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[k] = n;
  }
  for (const k of STRING_KEYS) {
    const raw = params.get(k);
    if (raw !== null && (raw !== "" || k.startsWith("value"))) out[k] = raw;
  }
  if (params.get("pinned") === "stale") out.pinned = "stale";
  const todo = params.get("todo");
  const match = TODO_VALUES.find((v) => v === todo);
  if (match) out.todo = match;
  return out;
};

/** The inverse of `parseMapFilter`; `""` for an empty filter. */
export const mapFilterToSearch = (filter: MapFilter): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== undefined) params.set(k, String(v));
  return params.toString();
};

export const isMapFilterEmpty = (filter: MapFilter): boolean => Object.values(filter).every((v) => v === undefined);

type Loaded = {
  message_id: string;
  thread_id: string;
  note_id: string;
  pin: string | null;
  created_at: number;
  title: string;
  content: string | null;
};

const firstLine = (content: string): string => {
  const line = content.split("\n").find((l) => l.trim()) ?? "";
  const t = line.replace(/^#+\s*/, "").trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
};

const inRange = (m: Loaded, f: MapFilter): boolean => {
  if (f.from !== undefined && m.created_at < f.from) return false;
  if (f.to !== undefined && m.created_at > f.to) return false;
  const date = new Date(m.created_at);
  if (f.weekday !== undefined && date.getUTCDay() !== f.weekday) return false;
  if (f.hour !== undefined && date.getUTCHours() !== f.hour) return false;
  return true;
};

// "set:value" keys for every live property value, per target.
const valueKey = (setId: string, value: string) => `${setId}\u0000${value}`;

const propertyIndex = async (d: Driver): Promise<Map<string, Set<string>>> => {
  const rows = await d.all<{ target_id: string; set_id: string; value: string | null }>(
    `SELECT pv.target_id, pv.set_id, pv.value FROM property_values pv
     JOIN entities se ON se.id = pv.set_id AND se.deleted_at IS NULL
     WHERE pv.removed_at IS NULL`,
  );
  const byTarget = new Map<string, Set<string>>();
  for (const r of rows) {
    const keys = byTarget.get(r.target_id) ?? new Set<string>();
    keys.add(valueKey(r.set_id, r.value ?? ""));
    keys.add(valueKey(r.set_id, "*")); // "any value of this set"
    byTarget.set(r.target_id, keys);
  }
  return byTarget;
};

// Every entity directly linked to `id` through a live link, in either direction.
const linkedTo = async (d: Driver, id: string): Promise<Set<string>> => {
  const rows = await d.all<{ from_id: string; to_id: string }>(
    `SELECT l.from_id, l.to_id FROM links l JOIN entities e ON e.id = l.id AND e.deleted_at IS NULL
     WHERE l.from_id = ? OR l.to_id = ?`,
    [id, id],
  );
  const out = new Set<string>([id]);
  for (const r of rows) {
    out.add(r.from_id);
    out.add(r.to_id);
  }
  return out;
};

// Ids touched by a pinned reference (a message's own pin, or a link's endpoints) whose note has moved on.
const stalePinned = async (d: Driver, messages: Loaded[]): Promise<Set<string>> => {
  const out = new Set<string>();
  const stale = async (pin: string) => {
    const [v] = await d.all<{ note_id: string }>("SELECT note_id FROM note_versions WHERE id = ?", [pin]);
    return v ? isReferenceStale(d, v.note_id, pin) : false;
  };
  for (const m of messages) if (m.pin && (await stale(m.pin))) out.add(m.message_id);
  const links = await d.all<{ from_id: string; to_id: string; pin: string }>(
    `SELECT l.from_id, l.to_id, l.pin_version_id AS pin FROM links l JOIN entities e ON e.id = l.id AND e.deleted_at IS NULL
     WHERE l.pin_version_id IS NOT NULL`,
  );
  for (const l of links)
    if (await stale(l.pin)) {
      out.add(l.from_id);
      out.add(l.to_id);
    }
  return out;
};

const todoState = async (d: Driver): Promise<Map<string, "open" | "done">> => {
  const rows = await d.all<{ target_id: string; done: number }>("SELECT target_id, done FROM todos");
  return new Map(rows.map((r) => [r.target_id, r.done ? "done" : "open"]));
};

/** Threads as rows, matching messages as cells, shared notes as connectors. Rows: most recently updated first. */
export const mapTracks = async (d: Driver, filter: MapFilter = {}): Promise<MapTracks> => {
  const all = await d.all<Loaded>(
    `SELECT m.id AS message_id, m.thread_id, m.note_id, m.pin_version_id AS pin, ne.created_at, t.title,
       (SELECT content FROM note_versions v WHERE v.note_id = m.note_id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) AS content
     FROM messages m
     JOIN entities me ON me.id = m.id AND me.deleted_at IS NULL
     JOIN entities ne ON ne.id = m.note_id AND ne.deleted_at IS NULL
     JOIN threads t ON t.id = m.thread_id
     JOIN entities te ON te.id = t.id AND te.deleted_at IS NULL
     WHERE m.removed_at IS NULL
     ORDER BY t.updated_at DESC, t.id`,
  );

  const links = filter.linkedTo !== undefined ? await linkedTo(d, filter.linkedTo) : null;
  const stale = filter.pinned === "stale" ? await stalePinned(d, all) : null;
  const wantsValues = filter.setA !== undefined || filter.setB !== undefined;
  const values = wantsValues ? await propertyIndex(d) : null;
  const todos = await todoState(d);

  const todoOf = (m: Loaded) => todos.get(m.message_id) ?? todos.get(m.note_id) ?? null;
  const targets = (m: Loaded) => [m.message_id, m.note_id, m.thread_id];
  const has = (keys: Set<string> | undefined, set: string | undefined, value: string | undefined) =>
    set === undefined || !!keys?.has(valueKey(set, value ?? "*"));

  const matches = (m: Loaded): boolean => {
    if (!inRange(m, filter)) return false;
    if (links && !targets(m).some((id) => links.has(id))) return false;
    if (stale && !targets(m).some((id) => stale.has(id))) return false;
    if (values) {
      const ok = targets(m).some((id) => {
        const keys = values.get(id);
        return has(keys, filter.setA, filter.valueA) && has(keys, filter.setB, filter.valueB);
      });
      if (!ok) return false;
    }
    if (filter.todo) {
      const state = todoOf(m);
      if (!state || (filter.todo !== "any" && state !== filter.todo)) return false;
    }
    return true;
  };

  const kept = new Map<string, Loaded>();
  const threads = new Map<string, { title: string; ids: Set<string> }>();
  for (const m of all) {
    if (!matches(m)) continue;
    kept.set(m.message_id, m);
    const entry = threads.get(m.thread_id) ?? { title: m.title, ids: new Set<string>() };
    entry.ids.add(m.message_id);
    threads.set(m.thread_id, entry);
  }

  const rows: MapRow[] = [];
  for (const [threadId, { title, ids }] of threads) {
    const order = await orderedMessageIds(d, threadId);
    const cells: MapCell[] = [];
    for (const id of order) {
      const m = ids.has(id) ? kept.get(id) : undefined;
      if (m)
        cells.push({
          messageId: id,
          noteId: m.note_id,
          createdAt: m.created_at,
          preview: firstLine(m.content ?? ""),
          todo: todoOf(m),
        });
    }
    rows.push({ threadId, title, cells });
  }

  return { rows, connectors: connectors(rows) };
};

// A note shown in two or more rows. Within one row only its first cell is a stop.
const connectors = (rows: MapRow[]): MapConnector[] => {
  const byNote = new Map<string, MapConnector>();
  rows.forEach((row, r) => {
    const seen = new Set<string>();
    row.cells.forEach((cell, c) => {
      if (seen.has(cell.noteId)) return;
      seen.add(cell.noteId);
      const hit = byNote.get(cell.noteId) ?? { noteId: cell.noteId, label: cell.preview, stops: [] };
      hit.stops.push({ row: r, cell: c });
      byNote.set(cell.noteId, hit);
    });
  });
  return [...byNote.values()].filter((c) => c.stops.length > 1);
};

/** What the filter controls can offer: every live property (set, value) pair, and every note/thread that has links. */
export const mapFilterOptions = async (d: Driver): Promise<MapFilterOptions> => {
  const properties = await d.all<{ setId: string; name: string; value: string }>(
    `SELECT DISTINCT ps.id AS setId, ps.name AS name, COALESCE(pv.value, '') AS value
     FROM property_values pv
     JOIN property_sets ps ON ps.id = pv.set_id
     JOIN entities se ON se.id = ps.id AND se.deleted_at IS NULL
     JOIN entities te ON te.id = pv.target_id AND te.deleted_at IS NULL
     WHERE pv.removed_at IS NULL ORDER BY ps.name, value`,
  );
  const ends = await d.all<{ id: string; kind: "note" | "thread"; n: number; title: string | null; content: string | null }>(
    `SELECT e.id, e.kind, COUNT(*) AS n, t.title,
       (SELECT content FROM note_versions v WHERE v.note_id = e.id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) AS content
     FROM (SELECT from_id AS eid, id AS lid FROM links UNION ALL SELECT to_id, id FROM links) x
     JOIN entities le ON le.id = x.lid AND le.deleted_at IS NULL
     JOIN entities e ON e.id = x.eid AND e.kind IN ('note','thread') AND e.deleted_at IS NULL
     LEFT JOIN threads t ON t.id = e.id
     GROUP BY e.id ORDER BY n DESC, e.id`,
  );
  return {
    properties,
    linkTargets: ends.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.kind === "thread" ? (e.title ?? "Thread") : firstLine(e.content ?? "") || "Untitled note",
      n: e.n,
    })),
  };
};

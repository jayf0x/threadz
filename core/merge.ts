import {
  type Changes,
  type Driver,
  type MessageRow,
  type Param,
  TABLE_NAMES,
  TABLES,
  type Table,
  type ThreadOrderRow,
} from "./schema";

// Sync between one phone and one main (docs/direction.md, "Sync"). A changeset is plain rows. Merging is
// the same on both sides:
// - immutable rows are insert-if-missing,
// - mutable rows are last-write-wins on `updated_at`,
// - on a tie, a row main has confirmed (rev set) beats one still pending, so main is the tiebreaker.
// A row arriving without `rev` stays pending until main stamps it.

export const emptyChanges = (): Changes => ({
  entities: [],
  note_versions: [],
  threads: [],
  messages: [],
  thread_order: [],
  links: [],
  property_sets: [],
  property_values: [],
  todos: [],
});

// Column names come from the schema itself, never from the incoming rows: a synced row is untrusted input
// and its keys must never reach the SQL text.
const columnsOf = async (d: Driver, table: Table) =>
  (await d.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);

const upsertSql = (table: Table, cols: string[]) => {
  const { pk, clock } = TABLES[table];
  const insert = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  const confirms = `(${table}.rev IS NULL AND excluded.rev IS NOT NULL)`;
  if (!clock) return `${insert} ON CONFLICT(${pk}) DO UPDATE SET rev = excluded.rev WHERE ${confirms}`;
  const set = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
  return `${insert} ON CONFLICT(${pk}) DO UPDATE SET ${set.join(", ")}
    WHERE excluded.${clock} > ${table}.${clock} OR (excluded.${clock} = ${table}.${clock} AND ${confirms})`;
};

// Apply a changeset in one transaction, then undo any thread delete that newer content beneath it outlived
// ("content wins").
export const applyChanges = (d: Driver, changes: Partial<Changes>) =>
  d.tx(async () => {
    for (const table of TABLE_NAMES) {
      const rows = changes[table] ?? [];
      if (!rows.length) continue;
      const cols = await columnsOf(d, table);
      const sql = upsertSql(table, cols);
      for (const row of rows as unknown as Record<string, Param>[]) await d.run(sql, cols.map((c) => row[c] ?? null));
    }
    await reviveThreads(d, await touchedThreads(d, changes));
  });

const touchedThreads = async (d: Driver, c: Partial<Changes>) => {
  const ids = new Set<string>();
  for (const t of c.threads ?? []) ids.add(t.id);
  for (const m of c.messages ?? []) ids.add(m.thread_id);
  for (const o of c.thread_order ?? []) ids.add(o.thread_id);
  for (const e of c.entities ?? []) if (e.kind === "thread") ids.add(e.id);
  const noteIds = [...new Set((c.note_versions ?? []).map((v) => v.note_id))];
  for (const noteId of noteIds)
    for (const r of await d.all<{ thread_id: string }>("SELECT thread_id FROM messages WHERE note_id = ?", [noteId]))
      ids.add(r.thread_id);
  return ids;
};

// A thread deleted on one side while the other side added to it comes back. Both sides compute the same
// result from the same rows, and the revived row's clock is the newest activity, so it beats the tombstone
// deterministically wherever it lands.
const reviveThreads = async (d: Driver, threadIds: Iterable<string>) => {
  for (const id of threadIds) {
    const [row] = await d.all<{ deleted_at: number | null }>("SELECT deleted_at FROM entities WHERE id = ?", [id]);
    if (row?.deleted_at == null) continue;
    const [act] = await d.all<{ at: number | null }>(
      `SELECT MAX(at) AS at FROM (
         SELECT e.created_at AS at FROM messages m JOIN entities e ON e.id = m.id WHERE m.thread_id = ?1
         UNION ALL SELECT m.updated_at FROM messages m WHERE m.thread_id = ?1
         UNION ALL SELECT v.created_at FROM note_versions v JOIN messages m ON m.note_id = v.note_id WHERE m.thread_id = ?1
       )`,
      [id],
    );
    if (act?.at != null && act.at > row.deleted_at)
      await d.run("UPDATE entities SET deleted_at = NULL, updated_at = ?, rev = NULL WHERE id = ?", [act.at, id]);
  }
};

// Main only: give every pending row the next rev. One rev per call; gaps are fine, only "greater than the
// cursor" matters.
export const stampRevs = (d: Driver) =>
  d.tx(async () => {
    const [cur] = await d.all<{ value: number }>("SELECT value FROM core_state WHERE key = 'rev'");
    const rev = (cur?.value ?? 0) + 1;
    for (const table of TABLE_NAMES) await d.run(`UPDATE ${table} SET rev = ? WHERE rev IS NULL`, [rev]);
    await d.run(
      "INSERT INTO core_state (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      [rev, rev],
    );
    return rev;
  });

const select = async (d: Driver, where: string, params: Param[] = []) => {
  const out = emptyChanges();
  for (const table of TABLE_NAMES)
    (out[table] as unknown[]) = await d.all(`SELECT * FROM ${table} WHERE ${where}`, params);
  return out;
};

// What main has that a device with this cursor hasn't seen.
export const changesSince = (d: Driver, cursor: number) => select(d, "rev > ?", [cursor]);

// What this side wrote that main hasn't confirmed yet.
export const pendingChanges = (d: Driver) => select(d, "rev IS NULL");

export const countChanges = (c: Changes) => TABLE_NAMES.reduce((n, t) => n + c[t].length, 0);

// A thread's messages in display order. Only a reorder writes `thread_order`, so the stored array can lag
// behind: ids no longer live are skipped, and live messages it doesn't mention are appended by creation time.
// Appending a message never touches the array, which is why an append can never conflict with a reorder.
export const orderedMessageIds = async (d: Driver, threadId: string) => {
  const live = await d.all<Pick<MessageRow, "id">>(
    `SELECT m.id FROM messages m JOIN entities e ON e.id = m.id
     WHERE m.thread_id = ? AND m.removed_at IS NULL AND e.deleted_at IS NULL
     ORDER BY e.created_at, m.id`,
    [threadId],
  );
  const [row] = await d.all<Pick<ThreadOrderRow, "message_ids">>(
    "SELECT message_ids FROM thread_order WHERE thread_id = ?",
    [threadId],
  );
  return displayOrder(
    live.map((m) => m.id),
    row?.message_ids,
  );
};

// The pure half of `orderedMessageIds`, for callers that already hold every thread's live ids (in creation
// order) and `thread_order` rows and would otherwise pay two queries per thread.
export const displayOrder = (liveIds: string[], storedJson: string | undefined): string[] => {
  const live = new Set(liveIds);
  const stored = storedJson ? (JSON.parse(storedJson) as string[]).filter((id) => live.has(id)) : [];
  const seen = new Set(stored);
  return [...stored, ...liveIds.filter((id) => !seen.has(id))];
};

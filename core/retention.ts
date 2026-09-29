import type { Driver } from "./schema";
import { headsOf, pinnedVersionIds, type VersionMeta } from "./versions";

// C12 retention: keep the newest KEEP_VERSIONS versions of a note (by created_at, id) and never delete
//  - a head (the current version),
//  - a version a message or link pins,
//  - anything of a conflicted note (two heads keep the whole history until resolved, which also keeps every
//    parent chain the conflict needs),
//  - a named version (no naming feature exists yet; its protection goes here when it lands).
// Only versions main has confirmed (`rev` set) are ever deleted, so a version that has not reached main is
// never lost. It cannot come back through sync: a device pulls only rows newer than its cursor and pushes
// only rows with no rev, and a pruned row is neither. If it re-enters anyway (a stale device, an imported
// file) the same rule prunes it again on that side's next run, so the sides converge. Run on main after a
// push and at startup, and on the phone after a sync.

export const KEEP_VERSIONS = 20;

export const pruneVersions = async (d: Driver, keep = KEEP_VERSIONS): Promise<number> => {
  const notes = await d.all<{ note_id: string }>(
    "SELECT note_id FROM note_versions GROUP BY note_id HAVING COUNT(*) > ?",
    [keep],
  );
  let removed = 0;
  for (const { note_id } of notes) {
    const vs = await d.all<VersionMeta & { rev: number | null }>(
      "SELECT id, parent_id, created_at, rev FROM note_versions WHERE note_id = ? ORDER BY created_at, id",
      [note_id],
    );
    const heads = headsOf(vs);
    if (heads.length > 1) continue;
    const protect = new Set([...heads, ...vs.slice(-keep).map((v) => v.id), ...(await pinnedVersionIds(d, note_id))]);
    const doomed = vs.filter((v) => v.rev != null && !protect.has(v.id));
    if (!doomed.length) continue;
    await d.tx(async () => {
      for (const v of doomed) await d.run("DELETE FROM note_versions WHERE id = ?", [v.id]);
    });
    removed += doomed.length;
  }
  return removed;
};

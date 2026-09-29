import type { Driver, NoteVersionRow } from "./schema";

// Version history and conflicts (docs/direction.md "Versions"). A version's `parent_id` is the version it
// was written on top of; a merge writes several, comma-joined ("a,b"), so both heads stop being leaves.
// A head is a version no other version of the note names as a parent. Two heads = two devices edited the
// same note = a conflict. Versions written before parents were recorded have `parent_id` NULL: each such
// version (except the note's first) counts as a child of the one before it by time, so old data never
// shows up as a conflict.

export type VersionMeta = Pick<NoteVersionRow, "id" | "parent_id" | "created_at">;

export const parentIdsOf = (parentId: string | null): string[] => (parentId ? parentId.split(",") : []);

// Oldest-first input (created_at, id).
export const headsOf = (versions: VersionMeta[]): string[] => {
  const parents = new Set<string>();
  versions.forEach((v, i) => {
    const prev = versions[i - 1];
    if (v.parent_id) for (const p of parentIdsOf(v.parent_id)) parents.add(p);
    else if (prev) parents.add(prev.id);
  });
  return versions.filter((v) => !parents.has(v.id)).map((v) => v.id);
};

export type VersionInfo = NoteVersionRow & { isHead: boolean; pinned: boolean };

// A note's versions, newest first.
export const listVersions = async (d: Driver, noteId: string): Promise<VersionInfo[]> => {
  const asc = await d.all<NoteVersionRow>("SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at, id", [
    noteId,
  ]);
  const heads = new Set(headsOf(asc));
  const pins = new Set(await pinnedVersionIds(d, noteId));
  return asc.reverse().map((v) => ({ ...v, isHead: heads.has(v.id), pinned: pins.has(v.id) }));
};

// Versions of this note that a message or link pins.
export const pinnedVersionIds = async (d: Driver, noteId: string): Promise<string[]> =>
  (
    await d.all<{ id: string }>(
      `SELECT pin_version_id AS id FROM messages WHERE note_id = ?1 AND pin_version_id IS NOT NULL
       UNION SELECT pin_version_id FROM links WHERE from_id = ?1 AND pin_version_id IS NOT NULL`,
      [noteId],
    )
  ).map((r) => r.id);

// The parent_id a new version of this note should carry: every current head (one normally, several while
// conflicted, which resolves the conflict). NULL for a note's first version.
export const nextParent = async (d: Driver, noteId: string): Promise<string | null> => {
  const asc = await d.all<VersionMeta>(
    "SELECT id, parent_id, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at, id",
    [noteId],
  );
  return headsOf(asc).join(",") || null;
};

const CHUNK = 400;

// Which of these notes have two or more heads. One query per chunk, not per note.
export const conflictedNotes = async (d: Driver, noteIds: string[]): Promise<Set<string>> => {
  const out = new Set<string>();
  for (let i = 0; i < noteIds.length; i += CHUNK) {
    const ids = noteIds.slice(i, i + CHUNK);
    const rows = await d.all<VersionMeta & { note_id: string }>(
      `SELECT note_id, id, parent_id, created_at FROM note_versions
       WHERE note_id IN (${ids.map(() => "?").join(",")}) ORDER BY note_id, created_at, id`,
      ids,
    );
    const by = new Map<string, VersionMeta[]>();
    for (const r of rows) by.set(r.note_id, [...(by.get(r.note_id) ?? []), r]);
    for (const [id, vs] of by) if (vs.length > 1 && headsOf(vs).length > 1) out.add(id);
  }
  return out;
};

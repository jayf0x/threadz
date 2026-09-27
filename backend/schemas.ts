import { z } from "zod";

// Request bodies. Zod only adds "wrong TYPE -> 400"; "field missing" stays with the
// handlers' own checks, so the fields they check are optional here.

// Sync (docs/direction.md "Sync"): a changeset is plain rows, one array per core table (core/
// schema.ts's `Changes`). Column names are untrusted input either way -- core/merge.ts's
// `applyChanges` reads `PRAGMA table_info` and only ever pulls known columns off a row, ignoring
// anything else -- so a row here is loosely typed on purpose: Zod's job is "the body is JSON
// shaped like a partial Changes object", not "every field/type is exactly right". A genuinely
// malformed value either fails at the SQLite layer (the caller's problem, still never a bare 500
// thanks to `wrap`) or is just a no-op (an unknown key is never read).
const Row = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const RowArray = z.array(Row).optional();

export const PushBody = z.object({
  entities: RowArray,
  note_versions: RowArray,
  threads: RowArray,
  messages: RowArray,
  thread_order: RowArray,
  links: RowArray,
  property_sets: RowArray,
  property_values: RowArray,
  todos: RowArray,
});
export type PushBody = z.infer<typeof PushBody>;

// Ask (docs/direction.md "B10"): main needs a thread to answer into and the question text. The
// thread's transcript is assembled from `core`'s `threadView` query server-side.
export const AskBody = z.object({
  threadId: z.string().optional(),
  question: z.string().optional(),
});
export type AskBody = z.infer<typeof AskBody>;

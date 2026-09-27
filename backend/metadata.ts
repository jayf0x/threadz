// v1's metadata pipeline (description/tags/embedding, generated fire-and-forget and stored on the
// old `threads` table, served from `/api/threads/:id/metadata` + `/api/threads/:id/related`) has no
// home in the v2 schema: core/schema.ts's `threads` table is just `id, title, updated_at, rev` --
// no description/tags/embedding columns -- and docs/direction.md's data model (Round 3-5) never
// reintroduces them. AGENTS.md's "the code stays for v2" referred to *this* file surviving for a
// future revisit, not to the v1 storage shape carrying over unchanged.
//
// Giving this a new home (a `property_set` holding a generated description? a dedicated table
// keyed by thread/entity id? where does an embedding, which is bytes, fit a schema whose only BLOB
// was this exact column?) is a real design decision, not a mechanical rename -- so it's flagged
// here rather than guessed at (see the D2a handback report). `/api/threads/:id/metadata` and
// `/api/threads/:id/related` are dropped from backend/server.ts for the same reason: there is
// nothing left in the schema for either to read or write.
//
// The two pure text-processing helpers below have no schema dependency and are kept in case
// metadata generation comes back in some v2 shape.

// Reject output that's just the instructions echoed back (small local models do this).
export const looksLikeGarbage = (s: string) =>
  /<=?\s*140|one sentence|short lowercase|topic (tag|keyword)|^string$/i.test(s.trim());

// Skip generation entirely below this — nothing to summarise, model will invent/parrot.
export const MIN_WORDS = 4;

// Images are `![](img:<hash>#WxH)` — noise to a text summariser.
export const stripImages = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

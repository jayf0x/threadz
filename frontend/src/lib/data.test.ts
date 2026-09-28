import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { initSchema } from "@threadz/core";
import { bunDriver } from "@threadz/core/bun";
import { placeVersionReference, resolveLiveVersionId } from "./data";

// `copyThread`'s core behavioral guarantee (docs/direction.md Decision 9: "Clone and Copy become
// version references"): a cloned message freezes to the version live at clone time, even if the
// original note is edited afterward. `copyThread` itself is pinned to the worker-backed phone db
// singleton (openPhoneDb/getPhoneDb), so — same as phone/driver.test.ts's fake-worker boundary —
// this drives the two helpers it's built from (`resolveLiveVersionId`, `placeVersionReference`)
// directly against a real `Driver` (`@threadz/core/bun` + `initSchema`), which is where all of the
// new branching logic lives.

const open = async () => {
  const d = bunDriver(new Database(":memory:"));
  await d.run("PRAGMA foreign_keys = ON");
  await initSchema(d);
  return d;
};

const note = async (d: Awaited<ReturnType<typeof open>>, id: string, versionId: string, text: string, at: number) => {
  await d.run("INSERT INTO entities VALUES (?, 'note', ?, ?, NULL, NULL)", [id, at, at]);
  await d.run("INSERT INTO note_versions VALUES (?, ?, NULL, ?, 'user', ?, NULL)", [versionId, id, text, at]);
};

test("resolveLiveVersionId: null pin follows the newest version; a pin id stays put once a newer version exists", async () => {
  const d = await open();
  await note(d, "n1", "v1", "first draft", 10);

  // Live (unpinned) resolves to the only version so far.
  expect(await resolveLiveVersionId(d, "n1", null)).toBe("v1");

  // A later edit to the source note adds a newer version.
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', 'v1', 'second draft', 'user', 20, NULL)");

  // Live now follows the newest version...
  expect(await resolveLiveVersionId(d, "n1", null)).toBe("v2");
  // ...but a reference pinned to the earlier version stays frozen to it.
  expect(await resolveLiveVersionId(d, "n1", "v1")).toBe("v1");
});

test("placeVersionReference: clone freezes to the version live at clone time, surviving a later edit to the original", async () => {
  const d = await open();
  await d.run("INSERT INTO entities VALUES ('src', 'thread', ?, ?, NULL, NULL)", [1, 1]);
  await d.run("INSERT INTO threads VALUES ('src', 'Original', ?, NULL)", [1]);
  await note(d, "n1", "v1", "first draft", 10);
  await d.run("INSERT INTO entities VALUES ('m1', 'message', ?, ?, NULL, NULL)", [10, 10]);
  await d.run("INSERT INTO messages VALUES ('m1', 'src', 'n1', NULL, ?, NULL, NULL)", [10]);

  // "Clone from here": resolve the live version now, then place a reference pinned to it — no new
  // note, no new note_versions row.
  const versionsBefore = (await d.all("SELECT id FROM note_versions")).length;
  const pinned = await resolveLiveVersionId(d, "n1", null);
  expect(pinned).toBe("v1");
  await d.run("INSERT INTO entities VALUES ('clone', 'thread', ?, ?, NULL, NULL)", [20, 20]);
  await d.run("INSERT INTO threads VALUES ('clone', 'Copy: Original', ?, NULL)", [20]);
  await placeVersionReference(d, "clone", "n1", pinned as string, 21);
  expect((await d.all("SELECT id FROM note_versions")).length).toBe(versionsBefore);

  // Editing the ORIGINAL message (a new note_versions row on the same note, same shape as
  // lib/data.ts's `editMessage`) must not change what the clone shows.
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', 'v1', 'edited after clone', 'user', 30, NULL)");

  const [cloneMsg] = await d.all<{ note_id: string; pin_version_id: string | null }>(
    "SELECT note_id, pin_version_id FROM messages WHERE thread_id = 'clone'",
  );
  expect(cloneMsg?.pin_version_id).toBe("v1");
  const [cloneVersion] = await d.all<{ content: string }>("SELECT content FROM note_versions WHERE id = ?", [
    cloneMsg?.pin_version_id ?? "",
  ]);
  expect(cloneVersion?.content).toBe("first draft");

  // The original, still unpinned, now shows the edit.
  const liveNow = await resolveLiveVersionId(d, "n1", null);
  expect(liveNow).toBe("v2");
});

// `editMessage`'s own re-pin branch (frontend/src/lib/data.ts) isn't reachable from this file
// (it's pinned to the worker-backed phone db singleton, same boundary as above) — this drives the
// same SQL shape directly against the raw driver to pin the behavioral contract: editing a pinned
// (cloned) message must re-pin it to the version it just wrote, or the edit would silently land on
// whichever OTHER message still follows that note live instead of the one being edited.
test("editing a pinned (cloned) message re-pins it, so the edit lands on that message, not the original", async () => {
  const d = await open();
  await d.run("INSERT INTO entities VALUES ('src', 'thread', ?, ?, NULL, NULL)", [1, 1]);
  await d.run("INSERT INTO threads VALUES ('src', 'Original', ?, NULL)", [1]);
  await note(d, "n1", "v1", "first draft", 10);
  await d.run("INSERT INTO entities VALUES ('m1', 'message', ?, ?, NULL, NULL)", [10, 10]);
  await d.run("INSERT INTO messages VALUES ('m1', 'src', 'n1', NULL, ?, NULL, NULL)", [10]);
  await d.run("INSERT INTO entities VALUES ('clone', 'thread', ?, ?, NULL, NULL)", [20, 20]);
  await d.run("INSERT INTO threads VALUES ('clone', 'Copy: Original', ?, NULL)", [20]);
  await placeVersionReference(d, "clone", "n1", "v1", 21);

  // Edit the CLONE's message — same shape as `editMessage`'s re-pin branch: a new version, then
  // (because the message being edited was pinned) the message's own pin follows that new version.
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', 'v1', 'edited via the clone', 'user', 30, NULL)");
  await d.run("UPDATE messages SET pin_version_id = ?, updated_at = ? WHERE thread_id = 'clone'", ["v2", 30]);

  const [cloneMsg] = await d.all<{ pin_version_id: string | null }>(
    "SELECT pin_version_id FROM messages WHERE thread_id = 'clone'",
  );
  expect(cloneMsg?.pin_version_id).toBe("v2"); // re-pinned to the edit it just wrote, not left stale on v1

  // The ORIGINAL message stays live (still `pin_version_id IS NULL`) and now shows the same edit —
  // an accepted consequence of sharing one note, not a regression: the clone no longer silently
  // "swallows" the edit, it just also isn't isolated from the original the way a real copy would be.
  const [originalMsg] = await d.all<{ pin_version_id: string | null }>(
    "SELECT pin_version_id FROM messages WHERE id = 'm1'",
  );
  expect(originalMsg?.pin_version_id).toBeNull();
  expect(await resolveLiveVersionId(d, "n1", originalMsg?.pin_version_id ?? null)).toBe("v2");
});

// "Branch from here" (Round 6): the real logic difference from "Clone from here" — a branched
// reference's `pin_version_id` is left NULL instead of frozen to the version live at branch time,
// so — unlike the clone test above — it keeps following the original note as it's edited afterward.
// `copyThread`/`branchThread` themselves are pinned to the worker-backed phone db singleton (see
// this file's top comment), so this drives the same `placeVersionReference(..., null, ...)` call
// `cloneOrBranchThread` makes for `pin: false` directly against a real `Driver`.
test("placeVersionReference(null): a branch stays live, picking up a later edit to the original", async () => {
  const d = await open();
  await d.run("INSERT INTO entities VALUES ('src', 'thread', ?, ?, NULL, NULL)", [1, 1]);
  await d.run("INSERT INTO threads VALUES ('src', 'Original', ?, NULL)", [1]);
  await note(d, "n1", "v1", "first draft", 10);
  await d.run("INSERT INTO entities VALUES ('m1', 'message', ?, ?, NULL, NULL)", [10, 10]);
  await d.run("INSERT INTO messages VALUES ('m1', 'src', 'n1', NULL, ?, NULL, NULL)", [10]);
  await d.run("INSERT INTO entities VALUES ('branch', 'thread', ?, ?, NULL, NULL)", [20, 20]);
  await d.run("INSERT INTO threads VALUES ('branch', 'Branch: Original', ?, NULL)", [20]);

  // Same resolve-then-place shape as a clone, but the branch passes `null` where the clone would
  // pass the resolved version id.
  const versionsBefore = (await d.all("SELECT id FROM note_versions")).length;
  await resolveLiveVersionId(d, "n1", null); // existence check, same as `cloneOrBranchThread`
  await placeVersionReference(d, "branch", "n1", null, 21);
  expect((await d.all("SELECT id FROM note_versions")).length).toBe(versionsBefore); // no new version, no new note

  const [branchMsg] = await d.all<{ note_id: string; pin_version_id: string | null }>(
    "SELECT note_id, pin_version_id FROM messages WHERE thread_id = 'branch'",
  );
  expect(branchMsg?.pin_version_id).toBeNull();

  // Editing the ORIGINAL message after branching...
  await d.run("INSERT INTO note_versions VALUES ('v2', 'n1', 'v1', 'edited after branch', 'user', 30, NULL)");

  // ...and the branch (still unpinned) resolves straight to that edit — unlike a clone, which would
  // stay frozen on 'v1'.
  const branchNow = await resolveLiveVersionId(d, branchMsg?.note_id ?? "", branchMsg?.pin_version_id ?? null);
  expect(branchNow).toBe("v2");
  const [branchVersion] = await d.all<{ content: string }>("SELECT content FROM note_versions WHERE id = ?", [
    branchNow ?? "",
  ]);
  expect(branchVersion?.content).toBe("edited after branch");
});

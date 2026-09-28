# Threadz direction

A working document, meant to be revised over several rounds. It records where Threadz is going, the research behind
that, and the data model it needs first. **Not a plan or a backlog**: nothing here is scheduled until it moves into
`backlog.md`. Where this document disagrees with `README.md` / `AGENTS.md`, those describe the app as it is today and
this describes where it is headed.

- Round 1 (2026-09-26): research, published as a visual report. Snapshot:
  [`research/2026-09-26-lines-through-the-pool.html`](research/2026-09-26-lines-through-the-pool.html). Where it
  disagrees with this file, this file is newer.
- Round 2 (2026-09-27): the user's answers to the nine questions and the four open calls. New themes: a normalized
  data model, every feature as a lens, groundwork first, AI as insight. Written up below.
- Round 3 (2026-09-27): critique of the model, then the user's answers. A message is a note placed in a thread.
  Properties live on the message as well as the note. There is one phone and one main, and nothing more for now.
  Device storage becomes real SQLite, with a full-snapshot export. "Tag group" is renamed "property set". Thread
  revert, conflict UI and native distribution are parked. The data model below is now a build spec.
- Round 4 (2026-09-27): a fresh start, so old data is dropped and there's no migration. The phone always works on its own
  copy, and main is only a sync target. Sync happens on a button, or on a "keep live" toggle that pushes and pulls
  diffs every N seconds. Phone storage is wa-sqlite on IndexedDB. Ends with "What to resolve, and how".

## Who it's for

People who brainstorm and develop ideas, and who want a pocket-sized place to write notes for blog posts, essays or
fiction. It offers AI help where it's useful, works offline, stays private and secure, and leaves the user in control.
In the long run it should adapt to anyone writing any kind of content. Some features will only serve some kinds of
writing, as in any app.

## Principles

1. **Never enforce.** Structure, connections, reasons, order and titles are always optional. A thread can be a raw
   brainstorm with zero connections, and that is a complete, valid use. Connection UI stays out of the way until it's
   wanted: no shiny buttons or links everywhere. What it looks like when switched on is tested and later made
   configurable.
2. **One database, many lenses.** A feature is a *query* over the shared data plus a *view* that shows the result. It
   is not a new model with new properties. A property set with a date value type already *is* a story
   timeline. A timeline screen is only a lens that sorts those values and draws them.
3. **Normalized atoms.** A note carries almost nothing of its own. It's like a cell: what it does depends on where it
   sits. Being in a thread, being a todo, having tags, being linked are each a separate *state* attached to the note,
   stored in its own table. A note doesn't know which thread it's in. A thread knows which notes it contains. This
   keeps queries maintainable and makes UI references follow directly from how the data is stored.
4. **Groundwork first.** Smart features built on an ad-hoc model will be unreliable. The normalized core (model,
   sync, query layer) comes before any new lens. Existing features then move onto it. Only after that come new
   views, insight and the map.
5. **AI is insight, not a character.** The AI layer turns the results of real queries into short natural language
   ("you came back to this theme in four threads this month"). No named or personified features. Insight comes first
   because it's grounded in data. Suggestions and autocompletion come second, because they're harder to keep
   accurate and drift more easily.
6. **Time is data, not structure.** `created_at` is always kept and is useful: writing patterns, recurring themes,
   insight. The system never depends on it for order or meaning. Order is whatever the user chose.
7. **A strong default before customization.** Build one good default, see what people actually want to change, then
   make that configurable.
8. **Desktop and mobile stay close.** Same model, same lenses, same flows. Layout adapts, behaviour doesn't fork.

## Research summary (round 1)

The full sources, field notes and diagrams are in the round 1 snapshot. What follows is the part later rounds rely
on.

### Where a connection is stored

Every tool answers this question, usually implicitly, and the answer decides what you can see, what you can create on
a phone, and what survives an export.

| Stored in | Tools | Strength | Breaks on |
|---|---|---|---|
| The text (`[[link]]`) | Roam, Obsidian, Logseq, Reflect, Bear, Threadz today | portable, shows *where* | no *why*; created with the keyboard, mid-writing |
| Membership (one item, many collections) | Are.na, Heptabase, Supernotes, Workflowy mirrors, Scrivener collections | an item lives in many contexts | a collection is a bag, with no order and no reason |
| Space (position, drawn arrows) | Scapple, Kinopio, Muse, Obsidian Canvas, LiquidText, Campfire | nearness carries meaning | can't be queried; desktop/iPad only; lost when the layout changes |
| Structure (types, fields, named relations) | Tana, Capacities, TheBrain, Novelcrafter codex | precise and queryable | needs a schema first; TheBrain is still niche after 25 years |
| Similarity (embeddings, tags) | Napkin, Smart Connections, Reor, Mem | no effort, surprising results | it's a guess; Mem's AI-only search lost users' trust |
| Sequence (order carries meaning) | Luhmann's Folgezettel, Memex trails, Scrivener binder, Plottr, Aeon narrative order | the only one that is itself writing: *B follows from A* | almost no tool treats order as a connection |

A coherent line of thought is a sequence. In the normalized model all six are either stored rows or lenses over the
same rows (see below), so Threadz doesn't have to pick one.

### What every tool has in common

A capture inbox. A "linked from" list. A local view of the neighbourhood that works, next to a global graph that
doesn't (Obsidian's hairball). Search as the main way around past a few hundred notes. The phone captures and reads
while the desktop arranges: Heptabase mobile couldn't move cards or draw arrows for a long time, Campfire's
relationships module isn't on mobile, Scapple has no mobile app, and Muse's iPhone app is an inbox. Stable ids under
everything.

### What sets tools apart

The home view (whiteboard, today's page, a channel, a swarm of related cards, an outline, a binder). The size of the
unit (page, block, card, object). Who makes connections (the user, a schema, a model). What you can take with you
(markdown, JSON Canvas, nothing).

### Mechanisms worth borrowing

- **Seeing a connection in context:** Xanadu's parallel documents and visible links; Matuschak's stacked panes;
  gwern.net's recursive, non-modal popups; Crusader Kings III's lockable nested tooltips (every name is a link); a
  local graph at depth 1–2; Heptabase's "this card is on these whiteboards, here".
- **One item in many places:** Are.na *connect* (no likes, only connections); Heptabase cards on many whiteboards;
  Workflowy mirrors (`((` trigger, a distinct bullet so a mirror is recognisable); Supernotes' multi-parent, and its
  "why does this appear twice?" confusion, a warning to mark repeated items.
- **Order as meaning:** Memex trails (a named path with comments and side trails); Folgezettel (`1 → 1a → 1a1`, "this
  continues that" is its own kind of link); Scrivener's binder, corkboard and Scrivenings as three views of one set of
  documents; Aeon's always-present chronological order next to an opt-in narrative order; Plottr's grid of plotlines ×
  chapters, a 2D view without a free canvas.
- **Structure that grows out of text:** Novelcrafter detects names and aliases, underlines them and counts them, with
  no model; Potluck (Ink & Switch) highlights text patterns, with the lesson that user-written patterns don't scale;
  Capacities uses the property name as the edge label; Tana search nodes that refer to their PARENT.
- **Space and its cost:** Capstone ("the DOM is misaligned with game-like continuous worlds"; a visible multi-item
  shelf); Muse (speed as a feature; big boards feel "wobbly"; phones unsolved); JSON Canvas as the export format if a
  free canvas ever ships.
- **Games:** Outer Wilds' ship log (map mode by place, rumor mode by what leads where, and visible "more to explore"
  loose ends); Disco Elysium's thought cabinet (ideas as loot, accept/reject); Her Story (a coherent story reached
  entirely through search, out of order).

## Data model (build spec, round 3)

The same schema runs on main (`bun:sqlite`) and on the device (SQLite compiled to WASM). The closest existing
pattern is **entity–component–system**, from games: an entity is just an id, *components* attach data to it, and
*systems* (here: lenses) are queries over components. That's "a note is a cell" expressed as storage.

### Vocabulary

- **Note:** raw, agnostic content. It belongs to no thread.
- **Message:** a note *placed* in a thread. It's an entity of its own, so it carries its own properties, todos and
  links. A counter, a chapter or a date "in this book" belongs to the message. "Character: Arya" belongs to the
  note.
- **Thread:** a title plus an ordered list of messages.
- **Link:** a connection between any two entities.
- **Property set:** the *definition* of one kind of value: name, value type, scope, optional rule, colour. Its
  instances are **values** on entities. A property set groups many instances of the same thing (every "story date" in
  book X). It does not group different properties together.
- **Version:** an immutable state of a note (and later, of a thread).

### Tables

| Table | Columns | Replaces |
|---|---|---|
| `entities` | `id, kind, created_at, updated_at, deleted_at, rev` — kind: `note`, `message`, `thread`, `link`, `property_set` | — |
| `note_versions` | `id, note_id, parent_id, content, author, created_at, rev` — immutable. `parent_id` is the version it was edited from. (A `name` for named versions comes with that feature.) | `messages.content/edits/edited_at/role` |
| `threads` | `id, title, updated_at, rev` | `threads` minus the AI columns |
| `messages` | `id, thread_id, note_id, pin_version_id, updated_at, removed_at, rev` — a placement (its creation time is on `entities`). `pin_version_id` null = live | `messages.thread_id` |
| `thread_order` | `thread_id, message_ids (JSON), updated_at, rev` — the order lives on the thread. Only a reorder writes it; see Sync | `messages.seq` |
| `links` | `id, from_id, to_id, pin_version_id, updated_at, rev` | — (inline `[[…]]` stays derived) |
| `property_sets` | `id, name, value_type, scope_thread_id, rule, color_slot, rev` — `value_type`: `none`, `text`, `number`, `date`; `rule`: null or `counter` | — |
| `property_values` | `id, set_id, target_id, value, created_at, removed_at, rev` — `target_id` is any entity, a message included | — |
| `todos` | `target_id, done, updated_at, rev` — any entity can be a todo | `meta.todo` |

- **Links have no kind column.** A link's type is a value from a property set, so types get their colours from the
  same place as everything else. A note attached to something is a note plus a link carrying a value from the
  built-in `attached` property set, which replaces the `annotations` table and its one-per-message limit. Built-in
  sets (`attached`, `copied-from`, capture source such as voice) are ordinary rows with fixed ids.
- **Colours are palette slots** (`color_slot` 1–8), never hex, so all six palettes re-theme them. Every chip also
  carries an icon or text as a second cue besides colour.
- **Rules are computed, not stored.** A `counter` numbers messages by their position in the thread and is recomputed
  when the order changes. Only a stamped value (an identity number that never changes) would be stored, and none is
  planned.

### No migration

v2 starts empty. Existing threads, messages, annotations, `threadz-local` and main's `threadz.sqlite` are not
carried over. Ids are plain client-generated UUIDs.

### Versions

- `note_versions` replaces `edits`. The latest version is the one with the newest `created_at`, ties broken by id.
- A reference (`messages.pin_version_id`, `links.pin_version_id`) is either **live** (null, follows the latest
  version) or **pinned** (a version id). A **copy** is not a reference: it's a new note, optionally with a
  `copied-from` link.
- **Retention:** keep the newest N versions per note (N configurable, default to be decided), plus every version that
  is named, pinned, or is a conflict branch. A version with zero references beyond the newest N is cleaned up. The same
  counting rule applies later to thread versions (keep Y).
- **Conflicts:** two versions with the same `parent_id` mean the phone and main both edited that note. Both are kept
  and newest wins for display. A conflict branch is never cleaned up. Resolving conflicts in the UI is its own feature
  (parked).
- **Thread versions and revert** are parked until the features they depend on exist. The table is not built yet.
  Snapshot after each submit, plus a save button that names the current version, is the leading option.

### Stored vs derived

- **Stored** (synced, the source of truth): explicit actions. Placing a note, a link made through a menu, a value, a
  todo toggle, a version.
- **Derived** (rebuilt on each device, never synced): anything parsed from text or computed. Inline `[[refs]]`, `/todo`
  lines, mentions, counters, the full-text index, embeddings, insight. A link that has a position in the text is
  written into the text (`[x](thread=…?message=…)`, later with a version pin). Only links between whole entities are
  rows.

### Sync (one phone, one main)

The phone always reads and writes **its own database**. Main is a sync target and the place where heavy work runs
(Ask, insight). There is no "live mode" that talks to main directly, and no auto-detach.

- **Sync now:** a button. It pushes pending rows, then pulls rows newer than the phone's cursor.
- **Keep live:** a toggle. While it's on, the phone runs the same push-and-pull every N seconds. It's not real-time;
  it's the button, pressed on a timer.
- **Only diffs travel.** `rev` is the database version: the phone sends only rows with no `rev` yet (pending), and
  pulls only rows with `rev` greater than its cursor. Nothing is sent twice, and nothing is merged twice.

This replaces per-thread hashes, `base`, and hash-checked deletes.

- **Every row has a `rev`.** Main stamps each write with a counter that only goes up.
- **Pull:** "rows with `rev` > my cursor". Push: the rows marked dirty on the phone. Main applies them, stamps revs,
  and returns them.
- **Deletes are tombstones** (`deleted_at` / `removed_at`), so they travel like any other row.
- **Merge rules:**
  - Immutable rows (`note_versions`) are insert-if-missing.
  - Mutable fields (title, order, todo, removal) are last-write-wins on their own timestamp.
  - "Content wins": a tombstone older than a live change beneath it is undone.
- **`thread_order`:** written only by a reorder, never by an append, and last write wins. The order is repaired
  on read rather than on write: stored ids that are no longer live are skipped, and live messages the array doesn't
  mention are appended by `created_at`. An append can therefore never conflict with a reorder, and a repair never
  creates sync traffic (`core/merge.ts` `orderedMessageIds`).
- **Backups:** main still takes a backup before applying a push. With keep-live on, that could be every N seconds, so
  backup retention has to be by time, not by count (see "What to resolve").

### Device storage and export

- The phone has no SQLite of its own. It runs SQLite compiled to WASM, stored in IndexedDB: still wa-sqlite's
  `IDBBatchAtomicVFS` under the hood, now reached through **`@subframe7536/sqlite-wasm`** (plain `wa-sqlite` ships
  without FTS5 compiled in; this wrapper's prebuilt async wasm has FTS5 + the trigram tokenizer baked in, see the
  Foundation spikes below). OPFS-based storage is less stable on iOS Safari. It's the same schema and the same
  queries as main.
- **Known risks** (PowerSync, May 2026): Safari can throw "maximum call stack size exceeded" on large queries with
  this VFS, and performance degrades beyond about 100MB. The first spike (below) measures both.
- iOS PWA storage is not trusted. **Export writes the whole database as a `.sqlite` file**: a full snapshot that
  opens in any SQLite tool. Import merges a file back with the same merge rules as sync.
- Images stay as they are (their own store, never in a snapshot).

## Lenses

Each existing and planned feature, described as a query plus a view. It's also a checklist: an existing feature
isn't done moving until it reads only through the query layer.

| Lens | Query | View |
|---|---|---|
| Thread, chat mode | a thread's order → messages → latest (or pinned) versions | bubbles with timestamps, for quick drafts |
| Thread, line mode | the same query | one continuous document; coherence possible, never required |
| Pool | notes with no live message | a shelf of loose ideas; not a home screen |
| Todos | entities with a `todos` row, plus derived `/todo` lines | today's tab, now for notes, messages, links, threads |
| Bin | entities with `deleted_at` | today's tab |
| Search / ⌘K | full-text over latest versions and titles | today's palette |
| Gutter | per message: other threads its note is in, links in/out, values, todo | GitLens-style marks; off until wanted |
| Peek | one linked entity plus its neighbours in its own thread | an overlay that can open further overlays |
| Timeline | values of a date-typed property set, sorted | a thread or the map, sorted by date |
| Insight | counts and co-occurrences over the above and `created_at` | short sentences, each linked to its source query |
| Map | any of the above, filtered | the central computed overview |

**Chips are the one UI primitive for attached state.** A chip is a value, link, todo or version marker: a colour slot
plus an icon or text. Clicking it does whatever its type does: a link navigates, a version opens a picker, a todo
toggles, a date opens a date picker. A new property set gets UI for free. Making a link on a phone: select text → a
menu → it becomes a link or command.

## Decisions

Decided (D), leaning (L), open (O), parked (P).

1. **Connections.** (D) A row between two entities, typed by a property value, optionally explained by an attached
   note, and always optional. (O) Customizable reverse labels.
2. **Seeing connections.** (D) Gutter marks, peek, and the map. None are shown until wanted.
3. **Making connections with one thumb.** (D) Select text or long-press → menu. (L) A link can be a todo.
4. **Time.** (D) `created_at` is kept for insight and never used for structure. Story time is a date-typed property
   set.
5. **One home or many.** (D) Many. A note belongs to no thread. A message is that note placed in a thread, and it
   carries placement properties (round 3).
6. **AI.** (D) Insight first, no personas. (L) Suggestions later. (O) Coherence scoring as research.
7. **Canvas / map.** (D) Computed first, free-form later. One central place with filters instead of many views.
8. **Structure.** (D) Property sets with a value type, a scope and an optional computed rule. One colour slot per set.
9. **Code cost.** (D) Order is an array on the thread. `threadId` is inverted into messages. Clone and Copy become
   version references. Rewrites are welcome.
10. **Thread revert.** (P) Revisit once versions, messages and property values exist.
11. **Merging.** (D) One phone and one main. The phone always works on its own copy. Sync is a button, or a
    keep-live toggle that syncs diffs every N seconds. Conflicting edits keep both versions, newest shown. (P) Conflict UI;
    multi-device and account setups.
12. **Platform.** (P) Capacitor, Xcode and distribution. (D) The phone is self-sufficient: wa-sqlite on IndexedDB,
    the same schema as main, and export is a full `.sqlite` snapshot.
14. **Fresh start.** (D) No migration; old data is dropped.
13. **Naming.** (D) "Property set", not "tag group" or "property".

Open calls, answered: no single genre; chat and line are interchangeable views; the app opens where you left off, and
home is a navigation dashboard; link reasons are always optional.

## Round 5 (2026-09-27): the open calls, answered

- **B6 clock trust:** clamp only. Main clamps any future timestamp to now (`clampTs`, already exists). One phone,
  one main — a wrong clock is rare and low-stakes; no per-row HLC.
- **B7 keep-live:** 15s interval while the tab is visible. On 5 consecutive failed polls, keep-live turns itself off
  (not infinite backoff) and the status UI shows main unreachable; the user re-enables it. Pauses while hidden, as
  already decided.
- **B10 Ask while unreachable:** not offered. The Ask control is disabled/greyed out rather than queuing a request —
  no state for "an Ask is pending an answer that'll show up later."
- **C11 deletion:**
  - Remove a message from a thread → the note goes to the Pool if it has no other placement, otherwise stays where
    it is (untouched).
  - Delete a thread → the thread entity and its messages all get `deleted_at` together, restorable as one unit from
    the Bin. Notes left with no placement go to the Pool, not the Bin (they're not deleted, just unplaced).
  - Delete a note placed in several threads → the note gets `deleted_at`, and every message that placed it tombstones
    with it — it disappears from everywhere at once and restores as one Bin entry.
  - Delete a link or a property set → tombstone only (`deleted_at`); property values under a deleted set become
    inert (no chip renders) but are not deleted themselves.
  - Purge → a real hard delete of the row and everything that referenced it; this can break pins, and that's
    accepted and documented, not guarded against.
- **C12 version retention:** default 20 versions per note. Named, pinned and conflict-branch versions are kept
  regardless of count, per the existing rule.
- **C14 reference grammar:** `tz:<kind>/<id>@<version>`, version suffix omitted for a live (unpinned) reference.
- **C15:** confirmed — the Todos lens shows both derived `/todo` lines and explicit `todos`-table toggles together,
  as it does today.

## Round 6 (2026-09-28): wave 6 UI decisions

- **Main-derived data.** A third kind of data, alongside stored and derived: written by main only, synced
  main → phone only, replaced wholesale (never merged) and rebuildable from scratch at any time. Lives in its
  own tables (`derived_*`), and the phone treats them as strictly read-only — no local write path, ever. Specced
  now so embeddings/insight/related-threads (see `backlog.md`) have a schema location when they're built; no
  `derived_*` table exists yet and none is built this wave.
- **Pool.** Reached from the Threadz thread list (a link/button), not a fifth tab. Consistent with "not a home
  screen" (Decision 5) and keeps the tab bar at four.
- **Line mode.** A per-thread toggle in the thread header's ⋯ menu. The choice is remembered per device (not
  synced), since it's a view preference, not content.
- **Property sets UI.** Sets (create, rename, delete) are managed from a Settings section. A value is added to
  any entity from that entity's ⋯ menu ("Add property"); the message ⋯ menu gets the same action.
- **Clone vs branch.** Two separate ⋯ menu items: "Clone from here" (today's behavior — pins frozen at the
  version live when cloned) and "Branch from here" (same mechanism, pins left empty, so it follows the
  original's live version). Not a toggle on one action — the two are different enough in outcome to name
  separately.
- **Local-only flag.** A built-in property set on a thread. No local model exists, so today it does exactly one
  thing: Ask is disabled/greyed out for that thread. Nothing else reads the flag yet.
- **Gutter marks.** Off by default, a Settings toggle turns them on — per "never show until wanted" (Principle
  1).

## Round 7 (2026-09-28): wave 7 decisions

- **Insight v1 is deterministic and phone-side.** Templated sentences over `core/insights.ts` queries; no model,
  works offline. Every sentence carries the lens and filter that produced it; no source, no sentence. Because of
  this, `derived_*` tables stay spec-only until the embeddings wave (replace unit, generation id and endpoint are
  decided then).
- **Home dashboard.** The app reopens the last route (remembered per device). The dashboard is reached by tapping
  the app mark/title in the header, not a tab. Contents: recent threads, open todos, Pool count, insight cards.
- **Computed map v1: "tracks".** One row per thread, its messages left to right; a note in several threads is a
  vertical connector between rows. Presets filter by property value, linked-to, todo and time range. Same
  component on phone and desktop (the phone scrolls). Saved presets are device-only settings, not synced.
- **Wave 6 polish, all four:** clickable link chips (via the gutter/peek read path), line-mode arrival scroll +
  highlight, built-in property sets out of `[[` candidates, note candidates beyond the Pool.

## Round 8 (2026-09-28): wave 8 hardening decisions

1. **Index header:** Pool and Map fold into one ⋯ menu ("rarely-used UI is never shown up front"; fixes 375px).
2. **Map todo filter** includes `/todo` lines, matching the Todos lens (C15).
3. **Pages `404.html`** is the standard SPA fallback, so `/threadz/map` survives a hard reload.
4. **Insight cards** that point at the Threadz, Todos or Pool lenses only open that panel; no filter inputs are added
   ("one tab, one job").
5. **Performance budgets** at the seeded `real` volume (headless Chromium, iPhone size, 4x CPU throttle): open thread
   <150ms, search <200ms, Todos <200ms, Home/insight <300ms, Map first paint <500ms, keep-live sync with nothing to
   send <100ms.

(The user delegated 1-3 to the lead: "most scalable yet pragmatic". The defaults were chosen.)

### Insight tuning constants

Live in `core/insights.ts`; change them there and here together.

| Constant | Value | Used by |
|---|---|---|
| `RHYTHM_WINDOW_DAYS` | 30 | writing rhythm: busiest weekday / hour over live notes' `created_at` |
| `RHYTHM_MIN_NOTES` | 5 | rhythm card needs at least this many notes in the window |
| `STALE_THREAD_DAYS` | 30 | threads untouched this long |
| `POOL_OLD_DAYS` / `TODO_OLD_DAYS` | 7 / 7 | Pool notes / open todos older than this |
| `MOST_LINKED_TOP` | 3 | top-N most-linked notes |
| `COOCCUR_MIN` / `COOCCUR_TOP` | 3 / 3 | property values co-occurring on at least 3 notes, top 3 |

Rechecked against the `real` seed (2026-09-28): every query fires (12 cards) and each has a source. The seed has
far more activity than a person (~1,700 notes in 30 days, 65% of threads stale), so the counts read large
(1,292 stale threads, 398 old todos) and the 5-note minimum is never the limiting factor. The constants stay; the
device run with real data is the real tuning test. If cards feel noisy there, raise `STALE_THREAD_DAYS` first.

## What to resolve, and how

Ordered by what blocks what. Each item says what's unknown, how to settle it, and what it blocks. Nothing below the
first group should be built before that group is answered.

### A. Foundation: settle with spikes on a real iPhone

1. **Can the phone hold the database?** wa-sqlite with `IDBBatchAtomicVFS`, in the installed PWA.
   - Seed realistic volume: about 10k notes, 50k versions, 2k threads.
   - Time the three heaviest lenses: a thread view, full-text search, the Todos query.
   - Try to trigger the known Safari stack overflow with a large query.
   - Check the data is still there after a week of not opening the app.
   - *Settles:* go, or fall back to plain IndexedDB stores. *Blocks:* everything on the phone.
2. **The driver must be async.** The IndexedDB VFS needs wa-sqlite's async build, but `core/`'s `Driver` is
   synchronous today, because it was written for bun:sqlite.
   - Change the `Driver` to return promises; main wraps bun:sqlite.
   - *Blocks:* all shared queries.
3. **Search on the phone.** ~~Check the wa-sqlite build includes FTS5 with the trigram tokenizer~~ done: plain
   `wa-sqlite` doesn't ship FTS5; `@subframe7536/sqlite-wasm` does (its bundled async wasm has FTS5 + trigram
   compiled in, confirmed in `frontend/scripts/spike-sqlite-wasm/`), so the phone matches main's ranking.
4. **Export and import a real `.sqlite` file.**
   - Find how to get the database bytes out of the VFS (read the file through the VFS, or `VACUUM INTO` a memory file).
   - Verify the file opens in the `sqlite3` CLI, and that importing it on main merges with the sync rules.
   - *Blocks:* the "phone storage isn't trusted" safety net.

### B. Sync protocol: design it, then test it with `core/`'s sync harness

5. **Endpoints.**
   - `GET /api/changes?since=<rev>` returns rows plus the new cursor.
   - `POST /api/push` takes pending rows and returns them stamped. Retries are harmless because merging is
     idempotent.
   - Photos are still sent first.
6. **Clock trust.** Last-write-wins compares device timestamps, so a phone whose clock runs ahead wins every tie.
   - Minimum: main clamps future timestamps, as `clampTs` does today.
   - Stronger: a hybrid logical clock per row.
   - Decide which. This is the one real correctness hole in the sync rules.
7. **Keep-live policy.**
   - Pick a default N.
   - A PWA can't sync in the background on iOS, so keep-live only runs while the app is open. The UI should say so.
   - Retry with backoff while main is unreachable, keeping changes pending silently.
   - Pause while the page is hidden.
8. **Backups under keep-live.** Main backs up before each push, and it keeps 20 by count today. Pushing every N seconds
   would cycle through all 20 in minutes. Switch to retention by time: hourly for a day, daily for a month, then weekly,
   Time Machine's schedule.
9. **Status UI.** The Live / Offline / Local pill no longer fits, because the phone is always "local". The new states
   are: synced, N pending, keep-live on, and main unreachable. `AGENTS.md`'s mode rules (auto-detach, "never
   auto-switch back to live", keeping `remoteApi` and `localApi` identical) all go.
10. **Ask (Claude).** Main needs the thread before it can answer. The order is:
    1. push;
    2. `POST /ask`;
    3. main writes the question and the answer as notes;
    4. pull.

    Ask is unavailable while main is unreachable. Decide whether an unsent Ask queues or simply isn't offered.

### C. Model details: design decisions, then write them into the spec above

11. **Deletion, for each kind.** Write one table covering:
    - removing a message (does its note go to the pool if it has no other placement?);
    - deleting a thread (its messages go with it; its notes go to the pool or the Bin?);
    - deleting a note that's placed in three threads;
    - deleting a link, or a property set that has values.
    - Also **purge**: a hard delete for privacy, which also breaks pins.

    The Bin shows everything with `deleted_at` set.
12. **Version retention.**
    - Pick a default N.
    - Garbage collection runs on both sides with the same deterministic rule, so they agree without syncing the GC
      itself.
    - Named, pinned and conflict versions are protected.
    - A version is created on each saved edit, never per keystroke.
13. **Property sets.**
    - Scope: global vs one thread, and what a thread-scoped set means for a note placed in another thread.
    - Value types: `none`, `text`, `number`, `date`. Is "choice" needed for link types?
    - The counter rule is computed from the message's own thread order.
    - 8 colour slots, each with an icon.
    - The built-in sets.
    - Then spec the **chip** component once, for every attached state.
14. **Reference grammar in text.** Today's `[x](thread=…?message=…)` only reaches threads and messages. Choose one form
    that covers every kind and a version pin, for example `tz:<kind>/<id>@<version>`. It's parsed by `lib/references.ts`.
15. **Two kinds of todo.** A `/todo` line is derived from text; a `todos` row is an explicit toggle on any entity. Keep
    both, with the Todos lens showing both together. Confirm.

### D. Then rebuild, in this order

1. ✅ `core/`: an async driver, the schema, and the queries for the existing lenses.
2. ✅ Main on `core/` with a fresh database, plus the sync endpoints.
3. ✅ The phone on `core/`: wa-sqlite in a worker, export and import.
4. ✅ Sync v2: the button, keep-live, and the new status UI.
5. ✅ Existing features as lenses on the new data: thread chat view and composer, todos, Bin, search and ⌘K,
   references (now `tz:<kind>/<id>@<version>`, C14), attached notes (today's note overlay), clone (now true
   version references, decision 9). `README.md` and `AGENTS.md` rewritten to match.
6. ✅ New lenses (wave 6): property sets + the `Chip` primitive, line mode, Pool, links from a selection, gutter
   marks + peek, references to anything (note/link/property_set) + staleness, Branch from here + thread status +
   local-only, Ask about this message, backup retention by time (B8). Still open: customization.
7. ✅ Wave 7: insight v1 (`core/insights.ts`, deterministic), Home dashboard (header title tap, last route reopened),
   computed map v1 (`core/map.ts`, tracks view, device-only presets), wave 6 polish. Round 7 has the calls.

## Parked

- Carry gesture; suggestions; coherence scoring; free-form canvas and workflow orchestration (JSON Canvas export);
  metro-style map layout.
- Thread versions and revert; conflict resolution UI; multi-device and accounts.
- Capacitor, native share extension, App Store / TestFlight.
- An operation log / CRDT (Loro, Automerge) as the source of truth. Revisit if one phone plus one main ever becomes
  many devices.

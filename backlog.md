# Threadz backlog

Open items only. Resolved work lives in the git history; deliberate scope choices and how things work are in
`README.md` / `AGENTS.md`; ideas that are not committed to yet are in `inspiration.md`.

**v1 (incl. V1.5–V1.7) is closed.** What is left is v2, or can only be settled on a real iPhone.

## Open — v1

_Nothing._

## v2 features (deferred by design)

- **Everything AI-generated.** Descriptions, tags, embeddings and the views for them: tried in v1, no place for it
  yet (ideas for a details view and for tags in `inspiration.md`). D2a (main on `core/`) dropped
  the v1 generation pipeline (`backend/metadata.ts`, since deleted) and `/api/threads/:id/metadata` +
  `/api/threads/:id/related` entirely rather than adapt them: `core/schema.ts`'s `threads` table has no description/tags/embedding columns,
  and giving those a v2 home (a `property_set`? a dedicated table?) is a real design decision, not carried
  over; nothing of it is kept in the tree.
- **Related threads / "similar to x".** Was `GET /api/threads/:id/related`, removed in D2a along with the rest of
  metadata generation (see above) — no schema location for an embedding to read. When this comes back: one vector
  per thread failed for a fixable reason (built from `title + description + tags + the first 2000 chars` of the
  transcript, so a growing thread drifts away from its vector). Try per-note (or chunk) embeddings, keep
  generated text out of the embedding input, thread score = best/mean note match; judge on real data first. A
  semantic fallback for search would use the same embeddings. A graph version (entity extraction + community
  detection) comes after.
- **Vision captioning** for image-only notes (they get metadata from the title alone).
- **WebGPU whisper decode** where available (much cheaper per utterance; not on iOS).

## Wave 7 follow-ups

- **`/threadz/map` hard reload 404s** on the static Pages build (no `404.html` fallback); in-app navigation is fine.
- **Map todo filter ignores derived `/todo` lines** (only `todos` rows on the message or its note match).
- **Index header is tight at 375px** (search + Pool + Map + Home title); fold Pool and Map into one menu if it
  reads crowded on a real phone.
- **Insight `thread`/`todos`/`pool` cards ignore their filter** (those panels have no filter inputs); only `map`
  cards apply theirs.

## Device-only verification

Nothing left to build; this is what can only be *observed* on an iPhone (everything else is verified headless in
Chromium at iPhone size, including offline dictation from the production build). Code for each is in place.

- **wa-sqlite storage volume at scale (v2, direction.md "A. Foundation" #1):** seed ~10k notes, 50k versions, 2k
  threads into `IDBBatchAtomicVFS` (now via `@subframe7536/sqlite-wasm`'s `useIdbStorage`) on a real installed PWA
  and confirm writes/IndexedDB don't choke — the headless checks (`frontend/scripts/verify-phone-db/`)
  only exercise a handful of rows in desktop Chromium.
- **Lens query timing at that volume:** time a thread view, full-text search and the Todos query against the seeded
  10k/50k/2k dataset on real iOS Safari, not desktop Chromium.
- **Safari's "maximum call stack size exceeded" on large wa-sqlite queries** (PowerSync, May 2026 — already cited in
  docs/direction.md's "Device storage and export"): the headless checks above didn't reproduce it at their tiny data
  volume on desktop Chromium; check whether it shows up on real iOS Safari at the 10k-note volume.
- **Persistence after a week of the PWA not being opened:** confirm IndexedDB (and the wa-sqlite file inside it)
  survives Safari's real-world storage eviction after a week of idle time, not just a fresh install.
- ~~FTS5 trigram search on the phone~~ resolved: the plain `wa-sqlite` npm package has no FTS5 compiled in
  (spike since removed), but `@subframe7536/sqlite-wasm`'s bundled async wasm does, and its trigram
  tokenizer matches main's (checked in headless Chromium at iPhone size) — the phone no
  longer needs a plain-LIKE fallback search.
- **Keyboard and viewport:** the shell follows `visualViewport` (`lib/viewport.ts`); composer pin/unpin around the
  keyboard, reachable top/bottom of a long thread while it animates, no rubber-band on tab panels, safe-area padding.
- **Keyboard from taps:** Edit (`enterEdit()` + `lib/keyboard.ts` proxy), Add/Edit note in the sheet, the dictation tap.
- **Placement with the keyboard up:** note sheet, ⋯ menus, `[[` autocomplete, edited-row reveal.
- **Dictation:** the second start once crashed the iOS PWA (WebKit memory ceiling with whisper WASM + a fresh VAD
  session); WebKit suspends the mic seconds after screen-lock (won't fix in a PWA).
- **Images:** HEIC picker, camera capture, canvas memory on old iPhones, `navigator.storage.persist()` on the installed
  PWA, `crypto.subtle` on plain `http://`.
- **Capture deep link:** `?capture=1` may focus without raising the keyboard until one tap.
- **Voice model choice/quality and tuning constants** (`engine.ts`: `REDEMPTION_MS`, `MAX_UTTER_S`, `IDLE_UNLOAD_MS`);
  local-mode detach timing on a flaky Wi-Fi handoff.
- **Wave 6 touch interactions:** the selection→"Link" floating trigger's anchor/positioning against a real iOS
  text-selection handle (verified headless in Chromium only), and Peek nesting (a peek opened from inside
  another peek) on a real iOS keyboard/viewport.
- **Wave 7 (only checked headless against tiny/empty data):** Home with real recent threads/todos, and reopening
  the last thread on launch; the map with a few hundred threads (virtualized rows, connector alignment while rows
  measure, two-axis scroll feel under touch); insight sentences on a real corpus.

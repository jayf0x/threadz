# Threadz backlog

Open items only. Resolved work lives in the git history; deliberate scope choices and how things work are in
`README.md` / `AGENTS.md`; ideas that are not committed to yet are in `inspiration.md`.

**v1 (incl. V1.5–V1.7) is closed.** What is left is v2, or can only be settled on a real iPhone.

## Open — v1

_Nothing._

## v2 features (deferred by design)

- **Everything AI-generated.** Descriptions, tags, embeddings and the views for them: tried in v1, no place for it
  yet (ideas for a details view and for tags in `inspiration.md`). D2a (main on `core/`) dropped
  `backend/metadata.ts`'s generation pipeline and `/api/threads/:id/metadata` + `/api/threads/:id/related`
  entirely rather than adapt them: `core/schema.ts`'s `threads` table has no description/tags/embedding columns,
  and giving those a v2 home (a `property_set`? a dedicated table?) is a real design decision, not carried
  over. `looksLikeGarbage`/`stripImages`/`MIN_WORDS` are kept in `metadata.ts` as pure helpers for whenever this
  comes back.
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

## Performance (real seed, headless 4x throttle)

`bun run seed --scale real` (2k threads, 10k notes, 50k versions), imported through Settings > Import into a fresh
headless Chromium context at iPhone 13 size, CDP 4x CPU throttle, production build (`VITE_LOCAL=1`), cold reload per
sample. Repeat with `bun frontend/scripts/perf/run.ts --scale real --runs 5` (`--dump`, `--profile`, `--dist <dir>` for
a before column; header of the script says how it measures). Medians. **Caveat:** CDP cannot throttle a dedicated
worker, so SQL ran at desktop speed; "est." adds 3x the worker's own exec time (an upper bound). The device run
should compare against the "after" column.

| lens (budget) | before | after | est. worker 4x | worker round trips before -> after |
|---|---|---|---|---|
| open thread, tap to first text (<150ms) | 1151ms | 766ms | 875ms | 954 -> 62 |
| search, first request to last reply (<200ms) | 31977ms | 37ms | 147ms | 52,728 -> 2 |
| Todos tab tap to list (<200ms) | never (>30s) | 232ms | 232ms | 50,310 -> 0 |
| Home tap to rows (<300ms) | 253ms | 231ms | 231ms | 91 -> 0 |
| Map first paint (<500ms) | 13,436ms | 227ms | 567ms | 15,597 -> 5 |
| keep-live sync, nothing to send (<100ms) | never (>30s) | 58ms | 88ms | 53,388 -> 22 |

At load (cold reload, time since navigation): index list 2.4s -> 1.6s; Todos data never (within 10s) -> 1.6s; Home
data 11.7s -> 3.7s. JS heap after load 1046 MB -> 135 MB; import of the 96k-row seed 8.6s -> 3.6s.
Search excludes the 200ms debounce in `useThreads`, so the visible delay is that plus the number above. "Before" ran
with the same harness on the base revision; its search/Todos/sync numbers are queue time behind the load-time
Todos scan (50k worker round trips), which every panel triggers at boot because all panels mount.

What moved the numbers (`core/queries.ts`, `core/map.ts`, `core/insights.ts`, `lib/data.ts`, `lib/phone/worker.ts`):
one statement per lens instead of a worker round trip per row (thread entries, pool, todos, search hits, stale pins,
map orders); the search scans each note's newest version, not every version; 64 MB SQLite page cache in the worker
(the default cache made every scan re-read IndexedDB: Todos scan 2000ms -> 250ms, Pool 1400ms -> 50ms); partial
`rev IS NULL` indexes for the sync push; a sync that moved no rows no longer emits a change signal (it re-ran every
lens); concurrent identical reads share one query until the next change signal; the image GC reads only image-bearing
versions and waits 15s instead of scanning every message at the first editor mount.

Still over budget, and not a query problem:
- **Open thread (766ms):** data is ready ~50ms after the tap (worker exec 37ms); the rest is main-thread work that
  scales with the whole page (100k DOM nodes: 5k Todos rows, 2k index rows, all panels mounted). At `small` scale the
  same tap is 259ms. Virtualize the Todos list (and the index) or unmount hidden panels.
- **Todos tab tap (232ms):** rendering ~5k rows (3,098 open, 1,981 closed) unvirtualized; the data is already there.
- `Menu` built every item element eagerly and PoolPanel gave every Pool note a menu of every thread: 700 MB of
  retained React elements at `real` and a renderer crash at `large` (fixed here: `items` may be a function, called
  only while the menu is open).

`large` (`--scale large`: 8k threads, 40k notes, 200k versions, 140 MB): with the Menu fix the page loads (383k DOM
nodes, 483 MB JS heap, index list 7.5s after navigation at 4x, import 14s). Search 1.7s and Map 2.3s of worker time:
both scan more than the 64 MB page cache holds, so they grow with the database, not the result. Todos and Home
taps ~1s (DOM). No SQL variable-count risk left: the one `IN (?,?,...)` list (`annotationsFor`, one variable per
message in the thread) is now a subquery, and every remaining statement binds a fixed few parameters (upsert rows bind
at most one per column). SQLite here allows 500,000 variables on main (`MAX_VARIABLE_NUMBER`), and the wasm build's
limit was not read. Safari's "maximum call stack size exceeded" is not reproducible in Chromium (larger stack); the
spread-into-`push(...)` patterns that could hit it at these sizes are gone from `core`/`lib` (only a 3-element one
remains in `allInsights`).

## Device-only verification

Nothing left to build; this is what can only be *observed* on an iPhone (everything else is verified headless in
Chromium at iPhone size, including offline dictation from the production build). Code for each is in place.

- **wa-sqlite storage volume at scale (v2, direction.md "A. Foundation" #1):** seed ~10k notes, 50k versions, 2k
  threads into `IDBBatchAtomicVFS` (now via `@subframe7536/sqlite-wasm`'s `useIdbStorage`) on a real installed PWA
  and confirm writes/IndexedDB don't choke — the headless spikes (`frontend/scripts/spike-wa-sqlite/`,
  `frontend/scripts/spike-sqlite-wasm/`) only exercised a handful of rows in desktop Chromium.
- **Lens query timing at that volume:** time a thread view, full-text search and the Todos query against the seeded
  10k/50k/2k dataset on real iOS Safari, not desktop Chromium.
- **Safari's "maximum call stack size exceeded" on large wa-sqlite queries** (PowerSync, May 2026 — already cited in
  docs/direction.md's "Device storage and export"): the headless spikes above didn't reproduce it at their tiny data
  volume on desktop Chromium; check whether it shows up on real iOS Safari at the 10k-note volume.
- **Persistence after a week of the PWA not being opened:** confirm IndexedDB (and the wa-sqlite file inside it)
  survives Safari's real-world storage eviction after a week of idle time, not just a fresh install.
- ~~FTS5 trigram search on the phone~~ resolved: the plain `wa-sqlite` npm package has no FTS5 compiled in
  (`frontend/scripts/spike-wa-sqlite/`), but `@subframe7536/sqlite-wasm`'s bundled async wasm does, and its trigram
  tokenizer matches main's (`frontend/scripts/spike-sqlite-wasm/`, headless Chromium at iPhone size) — the phone no
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

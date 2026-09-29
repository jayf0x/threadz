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

## Performance (real seed, headless 4x throttle)

`bun run seed --scale real` (2k threads, 10k notes, 50k versions), imported through Settings > Import into a fresh
headless Chromium context at iPhone 13 size, CDP 4x CPU throttle, production build (`VITE_LOCAL=1`), cold reload per
sample. Repeat with `bun frontend/scripts/perf/run.ts --scale real --runs 5` (`--dump`, `--profile`, `--dist <dir>` for
a before column; header of the script says how it measures). Medians. **Caveat:** CDP cannot throttle a dedicated
worker, so SQL ran at desktop speed; "est." adds 3x the worker's own exec time (an upper bound). The device run
should compare against the "after" column.

| lens (budget) | before | after | est. worker 4x | worker round trips before -> after |
|---|---|---|---|---|
| open thread, tap to first text (<150ms) | 1151ms | 321ms | 427ms | 954 -> 56 |
| search, first request to last reply (<200ms) | 31977ms | 37ms | 147ms | 52,728 -> 2 |
| Todos tab tap to list (<200ms) | never (>30s) | 9ms | 9ms | 50,310 -> 0 |
| Home tap to rows (<300ms) | 253ms | 9ms | 9ms | 91 -> 0 |
| Map first paint (<500ms) | 13,436ms | 247ms | 585ms | 15,597 -> 5 |
| keep-live sync, nothing to send (<100ms) | never (>30s) | 44ms | 73ms | 53,388 -> 22 |

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

Todos list and thread index are now virtualized (`@tanstack/react-virtual`, measured rows like `ThreadView`): DOM after
load 100k nodes -> 18k, JS heap 135 -> 61 MB, Todos and Home taps are just a tab flip. (The harness scrolls the index,
untimed, until its target row is mounted.)

Still over budget, and not a query problem:
- **Open thread (321ms, budget 150):** the tap-to-first-request gap is ~70ms of main-thread work, the data is back
  ~90ms later, and the rest is each row's lazily loaded Milkdown editor mounting (the text only counts once an editor
  has rendered) plus two worker queries per row (links, property values: N+1 in `EntryRow`). Next: batch those two
  per-thread (`core/queries.ts`) and render the first rows as plain markdown before the editor mounts.
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

## iOS polish (wave 9, researched; see docs/direction.md Round 9)

Device checks that WebKit-at-iPhone-size can't prove:
- [ ] iOS 26: open the keyboard, close it, scroll soon after: header/tab bar/composer return to the edges (issue a).
- [ ] Background the installed PWA for a few minutes, reopen: bottom tab bar still sits on the home indicator (c).
- [ ] No rubber-band on tab panels; a thread at its top/bottom doesn't drag the page (d).
- [ ] Ship an update, open the installed PWA: "Update available" appears without a full close/reopen (e).
- [ ] Settings → Accessibility → Reduce Motion on: no entrance/scale animations remain (f).
- [ ] Liquid Glass fade under the status bar doesn't hide the header's top row (g).
- [ ] VoiceOver: tab bar, composer actions, chips, menus all announce a name and state.

## Device-only verification

Run this on an iPhone with the `real` seed. It is your checklist, not an agent's. Everything else is verified
headless in Chromium at iPhone size.

**Load the seed**
1. On the Mac: `bun run seed --scale real` writes `.seed/real.sqlite` (~35 MB, deterministic).
2. Get the file onto the iPhone (AirDrop / Files).
3. In the installed PWA: Settings → Data → Import → pick the file. Rows arrive pending; leave them unsent unless
   you want to push 10k notes to main.
4. Reload once, so timings are warm-cache and cold-start both.

**Budgets** (headless Chromium, 4x CPU throttle; see "Performance" below for the measured numbers). A real iPhone
should be at or under these.

| Screen / query | Budget |
|---|---|
| Open a thread | < 150ms |
| Search | < 200ms |
| Todos | < 200ms |
| Home and insight | < 300ms |
| Map, first paint | < 500ms |
| Keep-live sync, nothing to send | < 100ms |

**Storage**
- [ ] 10k notes / 50k versions / 2k threads: import finishes, then writes (send a message, edit) stay snappy and
  IndexedDB doesn't error.
- [ ] Safari "maximum call stack size exceeded" (PowerSync, May 2026): open Search, Todos, Home, Map and a thread
  with 100+ messages; none throws. Also try `--scale large` (~140 MB) if the first passes.
- [ ] Worker SQLite page cache (64 MB, `lib/phone/worker.ts`): right for `real`, too small for `large`; watch for
  memory-pressure reloads on an older iPhone and shrink or make it adaptive if it happens.
- [ ] Survives a week: leave the installed PWA closed for 7 days, reopen, and check the data is still there
  (Safari can evict idle storage).

- **iOS polish (Wave 9, done in code, device-only to confirm):** `lib/viewport.ts` now re-reads `visualViewport` on
  window `resize`, `focusout`, `pageshow`, `visibilitychange` and a 100/300/600 ms tick, and `scrollTo(0,0)`s ~350 ms
  after blur when nothing editable is focused and `offsetTop` is non-zero (iOS 26 stale offset). Check on a real iPhone:
  open keyboard in composer, dismiss by tapping outside, and by swipe-down; the header must not stay shifted; background
  the PWA with keyboard up and return. No `dvh` remains except as the `var(--vv-h, 100dvh)` fallback. Every scroller is
  `overscroll-behavior: none`. `prefers-reduced-motion` covered by Motion's `MotionConfig reducedMotion="user"` plus a global
  CSS block (spinners stop too). WebKit 26 (Playwright) loads at iPhone size, `--vv-h`/`--vv-top` set, no page errors;
  keyboard/visual-viewport panning cannot be reproduced there. VoiceOver: icon buttons already carry `aria-label`; the
  tab bar is a radio group inside `<nav aria-label="Sections">` (each radio named by its sr-only label). Device check:
  VoiceOver reads the tab bar as "radio button, 2 of 4, selected" and that is understandable.
- **Keyboard and viewport:** the shell follows `visualViewport` (`lib/viewport.ts`); composer pin/unpin around the
  keyboard, reachable top/bottom of a long thread while it animates, no rubber-band on tab panels, safe-area padding.
- **Ask about this message** (⋯ menu → `Composer.askAbout`): the field is focused one tick after the tap (the menu traps focus until
  it closes; `holdKeyboard()` bridges it), so check the keyboard rises on iOS. Also: `tz:message/…` in an Ask is just link text; confirm
  the model gets the message from the thread context it is sent, else resolve `tz:` refs in `POST /api/ask`.
- **Import picker on iOS:** the file input has no `accept` now; confirm Safari lets you pick a `.sqlite` file.
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

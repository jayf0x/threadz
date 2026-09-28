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
- [ ] Survives a week: leave the installed PWA closed for 7 days, reopen, and check the data is still there
  (Safari can evict idle storage).

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

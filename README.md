# Threadz — Personal Brain POC (v2)

A thread-based note app with one backend ("main") and one phone, each holding a real SQLite database on the
same normalized schema. The phone always reads and writes its own copy — there's no "live" mode that talks to
main directly — and moves data to/from main only when you say so: a Sync Now button, or a keep-live toggle that
does the same thing on a timer. See `docs/direction.md` for the data model and sync protocol this is built on,
and `backlog.md` for open questions and deliberate scoping.

## What's here

```
core/       Shared schema, queries and sync/merge logic (core/schema.ts, queries.ts, merge.ts). Runs on both
            main (bun:sqlite) and the phone (SQLite compiled to WASM) through one async Driver interface.
backend/    Bun + bun:sqlite service ("main"). HTTP API, the model seam, image storage.
frontend/   React 19 + Vite + Tailwind v4 PWA. The phone's own SQLite (a Web Worker), on-device whisper.
tests/      bun test — backend invariant + HTTP e2e tests (frontend and core tests sit beside their code).
scripts/    smoke.sh (curl end-to-end check against a running backend), deploy-pages.sh (triggers the Pages
            workflow), clean-worktrees.sh (removes leftover agent worktrees).
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- A logged-in `claude` CLI (for "Ask"). The backend calls Claude through the
  Claude Code SDK, which reuses the CLI's auth — no API key to manage. Default model
  is `claude-haiku-4-5-20251001` (`ANTHROPIC_MODEL` to change). If asks fail with an auth error, run `claude login`. (Or set
  `ANTHROPIC_API_KEY` — the SDK will use it instead.)

## Run it

```bash
bun install
# .env is optional — see .env.example. Everything has a working default.

bun run dev:backend         # -> http://0.0.0.0:8787
bun run dev:frontend        # -> http://localhost:5173 (also on your LAN IP)
```

Open `http://localhost:5173` on the Mac. On your phone, open
`http://<mac-lan-ip>:5173` (same Wi-Fi). The backend URL is static — same host as the
page on `:8787`, or `VITE_BACKEND_URL` at build time if it lives elsewhere.

### HTTPS on the phone (needed for mic, offline, install)

Browsers only enable the mic, the service worker and "Add to Home Screen" on a secure origin —
`http://<lan-ip>:5173` on the phone gets none of them (`localhost` is exempt). **How the phone reaches main
securely is undecided.** Tailscale is one option that works today, but it costs phone battery, so it is a
candidate, not the plan; a local CA on the LAN (e.g. mkcert), a reverse proxy or a tunnel are not evaluated yet.
The Tailscale recipe (`tailscale serve` gives each port a real cert):

```bash
tailscale serve --bg --https=443 http://localhost:5173    # frontend
tailscale serve --bg --https=8787 http://localhost:8787   # backend (page on https can't call http)
```

Then open `https://<mac>.<tailnet>.ts.net` on the phone. The default backend URL
(`<page host>:8787`) already matches. For a production build, serve `frontend/dist` the same way.

The computed backend URL is baked in at page load from `location.hostname`, so it's only right if the
page was loaded from the Mac's address. Opening `http://localhost:5173` on the phone itself and installing
from there points the installed app at itself, permanently — there is no fix by reinstalling. **Settings →
Backend URL** is the escape hatch: a device-only override (`localStorage`, never synced) that every request
reads fresh, so pointing it at the Mac's LAN IP or Tailscale address fixes it without reinstalling.

## Publish to GitHub Pages

Publishes a static build of the app, with no backend configured, to <https://jayf0x.github.io/threadz/>.

One-time, in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Then, from `main` (pushed; the workflow builds what is on GitHub), publish explicitly:

```bash
bun run pages:deploy        # = gh workflow run pages.yml --ref main
gh run watch                # optional: follow it
```

The workflow (`.github/workflows/pages.yml`) only runs when triggered this way (or from the Actions tab); a push
never publishes. It runs `bun run pages:build` (`VITE_LOCAL=1 VITE_BASE=/threadz/`, output `frontend/dist`). Run the
same command locally to inspect the build. `VITE_BASE` (default `/`) is the only thing that moves the app under a
sub-path; the normal dev/prod build is unchanged.

What gets published: the same PWA, minus a backend to sync with. The phone works exactly as it always does — it
owns its own SQLite database regardless of whether main is reachable — but `VITE_LOCAL=1` with no
`VITE_BACKEND_URL` hides Settings' Backend URL field (`lib/config.ts`'s `HAS_BACKEND`) and skips the presence
stream; there is no Claude/Ask (main runs the model), and Sync Now/keep-live have nothing to reach, so the
status pill stays "Unreachable" if you try. Notes and photos live in that browser's own storage, so each browser
or device has its own separate copy — move data between them with **Export / Import** (a real `.sqlite` file;
photos are not in it). Voice dictation works: the voice-activity files are served from the app itself
(`/threadz/vad/`), the whisper model is downloaded from Hugging Face on first use.

Install: on iOS open the URL in Safari, Share → **Add to Home Screen** (use the installed app, not a Safari tab, so
storage is not evicted after 7 days). On Chrome/Edge use the install icon in the address bar, or menu → Install Threadz.

## Test

```bash
bun run check               # typecheck + Biome + token lint + tests: the definition of "green"
bun test                    # core + backend invariants + HTTP e2e (stubbed model)
bun run smoke http://localhost:8787   # curl end-to-end against a live backend (Claude if logged in)
bun run typecheck
```

## Structure & conventions

```
core/                     Driver interface, schema, queries (one per lens), sync/merge logic — shared by main
                           and the phone
backend/                  main: the Bun server, bun:sqlite driver, the model seam, image storage
tests/                    invariant + HTTP round-trip tests
frontend/src/
  components/ui/          generic primitives (Button, Field, Input, Select, Eyebrow…): no app imports
  features/<name>/        one feature: components, its hooks, pure helpers, tests
    index.ts               the feature's public surface, the only thing other features import
  lib/                    the phone's own database (phoneDb.ts, phone/), sync (syncEngine.ts), api glue,
                           voice engine: change with care
  themes/                 the only place raw colours live
```

- Import across folders with `@/…`; use `./` only inside the same folder. A feature never reaches into
  another feature's files, only its `index.ts`.
- Feature-specific hooks and helpers live in the feature; `lib/` has no React components.
- File order: imports, types, the exported component, the pieces it calls (in call order), then constants.
  In a component: state and derived values, handlers, effects last.
- `strict` + `noUncheckedIndexedAccess`; `any` only behind a `biome-ignore` with a reason; narrow `unknown` at trust boundaries. Variants are
  `Record<Variant, string>` maps or `as const` lists that types derive from.
- Colours come from tokens only (`bun run --cwd frontend lint:tokens`); opt out of a genuine one-off with a
  trailing `// threadz-allow-raw-color`.

## Data model

One normalized schema (`core/schema.ts`), the same on main and on the phone: **entities** (an id + a `kind`:
`note`, `message`, `thread`, `link`, `property_set`), **note_versions** (immutable — an edit is a new row, never
an update), **threads** (a title), **messages** (a note *placed* in a thread — its own entity, so it can carry
its own todo/links/properties, distinct from the note's), **thread_order** (only written by a reorder, repaired
on read), **links** (a connection between any two entities, typed by a `property_values` row rather than a
`kind` column), **property_sets**/**property_values** (the definition and instances of any typed value — a
built-in `attached` set is what backs a note attached to a message), and **todos** (any entity can be flagged,
independent of the `/todo`-line convention parsed from text). See `docs/direction.md`'s "Data model" for the
full spec and the reasoning behind it. `core/queries.ts` is the read side — one function per lens (thread view,
Pool, Todos, Bin, search, links, property values) — and every feature reads through it (or through
`frontend/src/lib/data.ts`, a thin view-model layer on top for the frontend's existing shapes) rather than a
bespoke query.

## Sync

The phone always reads and writes its own database; main is a sync target, never a live pass-through. Every row
in every table carries a `rev` (main's write counter — `NULL` means "not on main yet"). Syncing is:

- **Push** — this device's pending rows (`rev IS NULL`) go to `POST /api/push`; main applies them
  (insert-if-missing for immutable rows like `note_versions`, last-write-wins on `updated_at` for everything
  else — "content wins" on a delete-vs-edit race), stamps each with the next `rev`, and hands them back stamped.
- **Pull** — `GET /api/changes?since=<cursor>` returns every row with a `rev` greater than this device's last
  cursor.
- **Sync Now** is one push then one pull. **Keep live** (a toggle) runs the same cycle every 15 seconds while
  the tab is visible, pausing when it's hidden and turning itself off after 5 consecutive failures (the status
  pill then shows Unreachable; you re-enable it once main is reachable again).

Nothing auto-syncs and nothing auto-detects "main is back" — every sync is something you (or keep-live)
triggered. A retry is always safe: merging is idempotent, so a push or pull that partially landed and got resent
just re-applies the same rows. The status pill shows one of four states (`docs/direction.md` "B9"): **Synced**
(nothing pending), **Keep-live** (the timer is on), **Pending** (N changes saved on this device, not yet sent),
**Unreachable** (the last attempt failed). Main clamps any client-supplied timestamp to "now" (`clampTs`) rather
than trusting a device's clock — one phone, one main, so a wrong clock is rare and low-stakes.

**Ask** (Claude) needs main: push → `POST /api/ask` (main assembles the thread via `core.threadView`, asks the
model, writes the question and the answer as new notes) → pull. It's simply unavailable (control
disabled/greyed) while the status pill is Unreachable — there's no "queued, will answer later" state.

**Backups.** Main backs itself up (`VACUUM INTO` a timestamped copy) before applying every push:
`backups/threadz-<time>.sqlite` next to the database (`THREADZ_BACKUPS` to relocate). Retention is by time,
Time Machine's schedule (`backend/db.ts`'s `selectBackupsToKeep`): hourly for the last day, daily out to a
month, weekly beyond that — so "keep live"'s roughly-every-15s pushes don't cycle through the whole window in
minutes. To revert main, stop the backend and copy one over `threadz.sqlite`.

## Device storage and export

The phone has no native SQLite; it runs SQLite compiled to WASM (`@subframe7536/sqlite-wasm`, FTS5 + trigram
compiled in) inside a dedicated Web Worker, backed by IndexedDB (`IDBBatchAtomicVFS`) — `frontend/src/lib/phoneDb.ts`
opens it, `lib/phone/{worker,driver,broker,protocol}.ts` are the postMessage plumbing that turns it into the same
async `Driver` interface `core/` expects. It's the same schema and the same queries as main.

- **Export** writes the phone's whole database as a real `.sqlite` file (Settings → Import/export) — openable in
  any SQLite tool, not a JSON snapshot. **Import** merges a file's rows back in with the same push/pull merge
  rules.
- iOS PWA storage isn't fully trusted (Safari can evict it), so export is the safety net; the app also asks the
  browser for persistent storage on the installed PWA.
- **Images are never in an export** — see "Photos in notes" below; they're their own store entirely.

## API (JSON, except the image bytes)

Request bodies are validated (`backend/schemas.ts`) — a malformed JSON body is a 400, never a 500; an unknown
field in a changeset row is simply never read (column names are looked up from the schema itself, not trusted
off the wire).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, model }` |
| GET | `/api/presence` | an idle server-sent-events stream each open tab holds; with `THREADZ_QUIT_ON_CLOSE=1` (desktop launcher) the server exits when the last one closes |
| GET | `/api/changes?since=<rev>` | pull: every row with `rev > since`, plus `{ cursor }` — main's current rev |
| POST | `/api/push` | push: a device's pending rows (one array per `core` table), applied atomically after a backup, stamped with the next rev, returned stamped alongside `{ cursor }` |
| POST | `/api/ask` | `{ threadId, question }` → assembles the thread via `core.threadView`, asks Claude, writes the question + answer as notes, returns `{ answer, changes, cursor }` (the caller applies `changes` the same way a pull does) |
| PUT | `/api/images/:hash` | store a photo: raw JPEG bytes, `:hash` = its sha256 hex. The body is re-hashed and must be a JPEG (magic bytes) ≤ 8MB, else 400/415/413. Idempotent: a replay changes nothing (`{ ok, stored }`) |
| GET | `/api/images/:hash` | the JPEG, `cache-control: immutable`; 404 if unknown |

There is no per-thread CRUD API any more — every mutation (create a thread, append a note, edit, delete, clone,
toggle a todo) happens directly on the phone's own database (`frontend/src/lib/data.ts`) and reaches main only
as rows in the next push. Main's orphan-image sweep runs at boot and then daily (`backend/images.ts`): a file no
`note_versions` row mentions, and old enough that it isn't just waiting for its note, is deleted.

## Starting and naming threads

The **+ New** pill (bottom right of the Threads tab; or `n`) makes a thread at once, called `Thread: 004` (threads + 1,
at least three digits; a number a delete left taken is skipped) and opens it — or reopens the newest thread if it is
still an untouched placeholder with no notes, rather than piling up empty ones. There is no form. **Name a thread from its first note** (Settings, on by default)
renames it when that note is sent or edited, using [yatefca](https://www.npmjs.com/package/yatefca): keyword
extraction, no model, so it also works offline. It only replaces a title nobody chose (the
placeholder, or exactly what it derived from the previous first note) and does nothing when the note is too thin to
name. **Regenerate title** in the row's ⋯ menu does the same on demand from all of the thread's notes, and does replace a
name you typed. That menu also has Rename, Export as Markdown (one thread's own content as a `.md` file, unlike
the whole-vault `.sqlite` Export), Copy link (a `[title](tz:thread/<id>)` reference, ready to paste into another note) and
Delete; Pin (device-only) stays a visible button on the row at every width.

**Capture deep link.** `?capture=1` opens the same way as **+ New**/`n` and focuses the composer — the installed PWA's
long-press icon menu offers it as "New note" (`vite.config.ts`'s manifest `shortcuts`). Unverified on iOS: WebKit
won't raise the keyboard from this without a direct tap, so it may land focused but silent until one tap.

## Settings

The gear in the bottom tab bar (Threads · Todos · Bin · Settings) flips the sidebar to Settings, top to bottom:
Sync (the status pill, a manual Sync Now, keep-live toggle), Naming (the auto-name switch), Display (Lock zoom, on by
default on touch devices), Backend URL (see "HTTPS on the phone"; hidden on a `VITE_LOCAL` build with no backend
configured), Appearance (the Light/System/Dark toggle and a palette dot per colour family — gruvbox, one,
everforest, solarized, catppuccin, nord — each ships both modes), Background (the default faint gradient, or your own
image with Remove and an opacity slider for how much of it shows through the panes), Dictation (the speech model) and
Import / export. They are all per device (`localStorage`, the wallpaper's bytes in their own IndexedDB), never synced.

## Todos

The Todos tab flips the sidebar to every todo across every thread, newest first, tap to jump to
its thread, scrolled straight to that message and briefly highlighted (a plain CSS flash — `.message-pulse`
in `styles.css` — not Motion, nothing enters or leaves the tree). A sidebar entry is one of three shapes
(`lib/todos.ts`'s `Todo`, a discriminated union on `kind`) — both a derived text convention and an explicit
per-entity flag feed the same list, side by side (`docs/direction.md` "C15"):

- **A single line.** The legacy `- [ ] `/`- [x] ` checkbox (loose, matches anywhere in a line), or `/todo <text>`
  (the older `@/todo` still works) — a command anchored to the start of a line, closed by wrapping it in real markdown strikethrough
  (`~~/todo <text>~~`). Text is the only source of truth; tapping the checkbox rewrites that one line in place
  (open↔closed) through the same edit path a normal edit uses (a new `note_versions` row).
- **A titled group.** `/todos <title>` followed immediately by a run of list-item lines (`- `, `- [ ]`, `- [x]`
  — stops at the first blank line or the first line that isn't a list item) renders as one card under `<title>`
  with its own items underneath, each independently tickable. A plain `- item` with no checkbox parses as open;
  ticking it adds the checkbox rather than requiring one up front.
- **A flagged entity.** The selected message's own Todo button (a toggle in its actions row, beside Edit / Add note / ⋯)
  flags the *whole message* as a todo without inserting any `/todo` text — a real `todos` table row (`core/schema.ts`;
  `target_id` can be any entity, message included), not a text convention. Toggling it goes straight through `setTodo`
  in `lib/data.ts`, never through an edit.

Closed todos (lines and flagged entities) show only if closed in the last 24h by default; a header dropdown
switches to all or none, and the header counts open and closed. A `/todos` group always shows every item. All three
shapes are read fresh from the phone's own database on every change (`lib/data.ts`'s `allMessages`, `lib/todos.ts`'s
pure `collectTodos` scan) — no separate store to keep warm. The jump itself reuses the same deep-link path a
reference or a `?thread=&msg=` link uses: `App.tsx`'s `openThreadAt(threadId, messageId)` opens the thread, selects
that message and hands `ThreadView` a `pulseMessageId`; once the message's index is known in the already-virtualized
list (`@tanstack/react-virtual`), it calls the virtualizer's `scrollToIndex` and pulses the row. The pair mirrors into
a shareable `?thread=<id>&msg=<id>` URL (a push when the thread changes, a replace when only the message does, so
Back steps between threads); it's parsed on mount and on `popstate` for a direct link or Back, through the same
`openThreadAt`.

## Notes attached to a message

A message's actions row has **Add note** (only shown when it doesn't already have one) — a short aside kept
separate from the message's own content, shown as a chip (its first line) under the message once it has one, and
opened in an overlay (`NoteSurface.tsx`, a popover from `md`, a sheet below it) to read or edit. Structurally
it's an ordinary note (its own entity + version history) plus a `link` carrying the built-in `attached` property
value (`core/schema.ts`'s `BUILTIN.attached`) — this is what replaced v1's dedicated one-per-message
`annotations` table (`docs/direction.md` "Links have no kind column"). Deleting it tombstones both the note and
the link (never a hard delete); adding a second note to a message that already has one is refused rather than
silently overwriting — the UI already only offers "Add note" when there isn't one.

## Clone ("Clone from here")

The ⋯ menu's **Clone from here** makes a new thread holding *version references* to the original messages up to
and including the one you clicked (`docs/direction.md` decision 9), plus, optionally, whatever you'd already
typed in the composer as one more brand-new note. A cloned message shares its **note** with the original but is
pinned (`messages.pin_version_id`) to whichever version was live at clone time — so it stays frozen even if the
original is edited afterward, with zero content duplication. Editing a message that came from a clone re-pins it
to the new version it just wrote (rather than silently writing an edit that only shows up in the *other*
thread), which also means it stops being frozen the moment you touch it. There's no `copied-from` link back to
the source thread (nothing reads one yet); Clone's own `⋯` menu item and the composer's "Clone from here" both
call the same `copyThread` in `lib/data.ts`.

## Property sets, chips and wave 6 lenses

**Property sets** (`core/schema.ts`'s `property_sets`/`property_values`) are the one typed-value primitive
behind chips, links, "attached", "local-only" and any future tag/status/date field — created and managed from
Settings (global sets) or from context (thread-scoped ones), with values set from any entity's ⋯ menu ("Add
property"). **Chip** (`components/ui/Chip.tsx`) is the one presentational primitive for rendering one: a colour
slot (1–8, palette tokens) plus an icon/text, dumb — the caller decides what a click does.

- **Line mode.** The thread header's ⋯ menu toggles a thread between chat bubbles and one continuous document
  (`LineEntry.tsx`); the choice is remembered per device, per thread (not synced — it's a view preference).
- **Pool.** Notes with no live placement anywhere, reached from the Threadz thread list (not a fifth tab) —
  "Send to thread" places a loose note as a new live message, which is exactly what removes it from the Pool.
  "Remove from thread" (a message's ⋯ menu) is the everyday way a note lands there.
- **Links from a selection.** Select text in the editor → the floating "Link" trigger → pick a thread or
  message, optionally typed by a property value afterward (the type's colour renders the link as a `Chip`).
- **Gutter marks + Peek.** Off by default (a Settings toggle turns them on): per-message marks for other threads
  the same note lives in, links in/out, property values and todo state. Clicking a link/other-thread mark opens
  Peek, a `ResponsiveOverlay` showing that entity plus its immediate neighbours — nestable, so a peek can open
  another peek.
- **References to anything.** The `[[` autocomplete now also offers notes, links and property sets (not just
  threads/messages) under the same `tz:<kind>/<id>@<version>` grammar. A pinned reference to a note shows a
  staleness marker once the note has moved past the version it points at.
- **Branch from here.** The ⋯ menu's second clone-shaped action: identical to Clone from here except its new
  references are left live (`pin_version_id` null) instead of frozen, so the branch keeps following the
  original's edits.
- **Thread status and local-only.** A thread can be flagged as a todo from its own header ⋯ menu (shows up in
  the Todos tab, never as filtering on the Threadz index — "one tab, one job"); "Local only" is a built-in
  property set that disables the Ask control for that thread.
- **Ask about this message.** A message's ⋯ menu can ask Claude to react to just that message; the answer lands
  as an assistant-authored attached note (the same `attached`-link mechanism as a manually written one), never
  appended to the thread.

## Insight, Home and the map

- **Insight** (`core/insights.ts`): deterministic queries on the phone (writing rhythm, stale threads, old Pool
  notes and todos, most-linked notes, co-occurring values, stale pins), templated into sentences. Each carries the
  lens and filter it came from; nothing with a zero count or no source is shown. No model, works offline.
- **Home**: tap the title in the Threadz header. Recent threads, open todos, Pool count, insight cards (each opens
  its lens). The app reopens the last panel/thread per device (`lib/lastRoute.ts`, not synced).
- **Map** (`core/map.ts`, `features/map/`, `/map?...`): a "tracks" view, one row per thread with its messages left
  to right, a note in several threads drawn as a vertical connector. Filters (property value, linked-to, todo,
  time range) live in the URL; saved presets are device-only (`lib/mapPresets.ts`).

## References and quick jump

Type `[[` in any note (composer, an edit, a note popover) to link another thread or message. A two-stage
autocomplete offers thread titles first, then that thread's messages (only what this device's copy already holds —
no fetch on demand). Tab/Enter completes a stage and continues into the next; Esc or tapping away stops wherever it
is and leaves what's already completed behind (a thread-only link stays thread-only). What's stored is a plain
markdown link whose href is the app's own reference grammar, `tz:<kind>/<id>@<version>` (`docs/direction.md`
"C14"): `tz:thread/<id>`, `tz:message/<threadId>/<from>..<to>` for a message or a range, with `@<version>`
appended only for a pinned reference (nothing writes one yet — every reference today is live). It isn't a real
browser `href` — Milkdown's link-mark schema is overridden (`features/editor/MarkdownEditor.tsx`) to render it
as `<a data-ref="tz:…">` with no `href` attribute, so it can never accidentally navigate the page away, and a
plain `https://…` link still renders and behaves normally. To make a range, keep the popup open after the first
message and pick a second one (the first stays pinned on top, so a bare Enter means "just this one"). A link
navigates in-app (never a page reload) through the same `openThreadAt` path as a todo jump or `?thread=&msg=`; a
range scrolls to its topmost row (in whichever sort order the thread is shown) and highlights every row in it.
The message and thread ⋯ menus have **Copy link**. `⌘K`/`Ctrl+K` opens a switcher that matches both thread
titles (instantly) and note content (debounced, same full-text search the sidebar uses).

## Photos in notes

The composer's image button (also paste / drop) takes a photo, shrinks it in the browser to ≤1600px on the
long edge as a JPEG (~0.8; every browser can encode JPEG, Safari can't do WebP/AVIF) and puts
`![](img:<sha256>#<w>x<h>)` in the note. The `#WxH` reserves a grey box of the right shape; the bytes are
only looked up when it scrolls into view. The note stays plain markdown — sync and the data model don't know
images exist.

- **Images are never synced as rows, on purpose.** Device: their own IndexedDB database
  (`threadz-images`, `lib/images.ts`), never touched by a `.sqlite` export/import or a sync push/pull. Main:
  plain files in `THREADZ_IMAGES` (default `images/` beside the database), not SQLite rows, so neither
  `VACUUM INTO` backups nor a push/pull payload carry them. There is no image backup at all beyond that: a photo
  is content-addressed and immutable, so a copy on the device that took it plus a copy on main is the whole
  story.
- **Not lost.** A photo taken on the device stays flagged `dirty` until main acknowledged its `PUT`, and is
  never deleted by anything. It's sent immediately on capture (best-effort) and again on every sync. Photos from
  main are cached on the device on first view; an uncached one while unreachable stays a grey box.
- **Orphans are collected.** Main deletes files no `note_versions` row (any kept edit included) mentions once
  they are older than 7 days (at startup, then daily). The device deletes clean cached images no note in its own
  database mentions (a day after caching); a `dirty` image is never deleted.
- **Deliberate limits.** No zip export (that would be an image backup), no alt text/captions (the note format is
  `![](img:<hash>#WxH)` only), no streaming upload (one ≤8MB `PUT` is fine at ≤1600px JPEG).

## Load-bearing decisions

- **Groundwork before lenses.** The normalized model, the async `Driver`, sync and the phone's own database all
  landed before any feature was rebuilt on top of them (`docs/direction.md` "D"); a feature that needs new
  `core/` surface extends `core/queries.ts` rather than growing a parallel one-off query.
- **One phone, one main, no live pass-through.** There is no "local mode" distinct from normal operation any
  more — the phone always works on its own copy, whether or not main is reachable; reachability only changes
  whether Sync Now/keep-live/Ask succeed.
- **Versions, not edits-in-place.** An edit is a new `note_versions` row, never an overwrite — `note_versions`
  is insert-if-missing on sync, so two edits made offline on both sides are both kept rather than one clobbering
  the other; the newest by `created_at` (ties broken by id) is what's shown live. Version retention (keep the
  newest 20 per note, named/pinned/conflict-branch versions exempt) runs the same deterministic rule on both
  sides, so it never needs its own sync traffic.
- **A `pin_version_id` freezes a reference; `null` follows the latest.** Clone uses this to avoid duplicating
  content (see "Clone" above); a version pin in a `tz:` reference (not written yet, but parsed) would work the
  same way.
- **Deletion is tombstones, never a hard delete** (`deleted_at`/`removed_at`), so a delete travels through sync
  like any other row and is always restorable from the Bin — except **Purge**, an intentionally-unguarded real
  hard delete that can break a pin pointing at what it removed.
- **One model seam.** All Claude calls go through `askModel()` in `backend/model.ts` — the plug point for a
  future routing gateway. It runs with no tools, no MCP servers and an empty working directory, so a prompt can
  never read the machine it runs on.
- **Nothing auto-syncs.** Coming back online changes nothing by itself; Sync Now or keep-live is always
  something you (or a timer you turned on) triggered.

# Threadz — Personal Brain POC (v1)

A thread-based chat PWA backed by one shared local-network service. Threads live in one
place; any device on the LAN can read and append; a device that loses the backend keeps working
on its own copy and syncs when you say so. See `backlog.md` for open questions and deliberate scoping.

## What's here

```
backend/    Bun + bun:sqlite service. HTTP API, model seam, metadata + embeddings (off by default — see below).
frontend/   React 19 + Vite + Tailwind v4 PWA. IndexedDB mirror + local copy, on-device whisper.
tests/      bun test — invariant + HTTP e2e tests.
scripts/    smoke.sh (curl end-to-end check against a running backend), deploy-pages.sh (triggers the Pages workflow).
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Ollama](https://ollama.com), only if you turn on generated metadata (`THREADZ_METADATA=1` — see "Metadata
  generation (v2, off by default)" below). Not needed otherwise; nothing calls Ollama with the flag off. If you do
  turn it on: these are test defaults, not decisions — any Ollama model that can emit JSON works for
  tags/descriptions (`THREADZ_GEN_MODEL`), the embedding model is swappable (`THREADZ_EMBED_MODEL`; vectors from
  different embedding models don't compare), and none of it has been benchmarked yet.
  ```bash
  ollama pull qwen3.5:0.8b       # tags + descriptions (small on purpose while testing)
  ollama pull nomic-embed-text   # embeddings
  ```
- A logged-in `claude` CLI (for "Ask Claude"). The backend calls Claude through the
  Claude Code SDK, which reuses the CLI's auth — no API key to manage. Default model
  is `claude-haiku-4-5`. If asks fail with an auth error, run `claude login`. (Or set
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

### Reach the backend + Ollama from the phone

The backend already binds `0.0.0.0`. Ollama does not by default:

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"   # then quit & reopen Ollama.app
```

(Only needed if `THREADZ_METADATA=1` — metadata/embeddings then run backend→Ollama; the phone
always talks only to the backend.)

The computed backend URL is baked in at page load from `location.hostname`, so it's only right if the
page was loaded from the Mac's address. Opening `http://localhost:5173` on the phone itself and installing
from there points the installed app at itself, permanently — there is no fix by reinstalling. **Settings →
Backend URL** is the escape hatch: a device-only override (`localStorage`, never synced) that every request
reads fresh, so pointing it at the Mac's LAN IP or Tailscale address fixes it without reinstalling.

## Publish to GitHub Pages

Publishes a static, local-only build of the app to <https://jayf0x.github.io/threadz/>.

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

What gets published: the same PWA in **local mode only**. There is no backend, no Claude/Ask, and no sync. Notes,
photos and dictation settings live in that browser's storage for the `jayf0x.github.io` origin, so each browser or
device has its own separate copy. Move data between them with **Export / Import** (JSON; photos are not in it).
Voice dictation works: the voice-activity files are served from the app itself (`/threadz/vad/`), the whisper model is downloaded from Hugging Face on first use.

Install: on iOS open the URL in Safari, Share → **Add to Home Screen** (use the installed app, not a Safari tab, so
storage is not evicted after 7 days). On Chrome/Edge use the install icon in the address bar, or menu → Install Threadz.

## Test

```bash
bun run check               # typecheck + Biome + token lint + tests: the definition of "green"
bun test                    # invariants + HTTP e2e (stubbed model)
bun run smoke http://localhost:8787   # real end-to-end against Ollama (+ Claude if logged in)
bun run typecheck
```

## Structure & conventions

```
backend/                 one Bun server, one SQLite file (server, db, model, metadata, images)
tests/                   invariant + HTTP round-trip tests
frontend/src/
  components/ui/         generic primitives (Button, Field, Input, Select, Eyebrow…): no app imports
  features/<name>/       one feature: components, its hooks, pure helpers, tests
    index.ts             the feature's public surface, the only thing other features import
  lib/                   device store, sync, api, voice engine: change with care
  themes/                the only place raw colours live
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

## API (JSON, except the image bytes)

Request bodies are validated (`backend/schemas.ts`): invalid JSON, a wrong type or a bad `role` is a 400 `{ error }`.
`GET /api/threads?q=` matches titles and note text; `%` and `_` in `q` are literal.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, model }` |
| GET | `/api/snapshot` | every thread + message in one read |
| GET | `/api/head` | `{ head, threads: { id: hash } }` — cheap "did main move?" (hash = title + message ids) |
| POST | `/api/sync` | a device's offline work `{ threads, messages, deletes:[{id,baseHash}] }`, applied atomically after a backup; a delete is refused if the thread changed since `baseHash` |
| GET | `/api/threads?q=&sort=updated\|created\|title` | list / search |
| POST | `/api/threads` | create `{ title, seed?, id?, createdAt? }` — idempotent on `id` |
| GET | `/api/threads/:id` | `{ thread, messages }` |
| PATCH | `/api/threads/:id` | rename `{ title }` |
| DELETE | `/api/threads/:id` | delete thread + messages |
| PATCH | `/api/threads/:id/messages/:mid` | edit `{ content }`; the old text is appended to `edits` |
| POST | `/api/threads/:id/messages` | idempotent append `{ id, content, role?, meta?, createdAt? }` |
| DELETE | `/api/threads/:id/annotations/:aid` | delete a note for good — no tombstone, unlike a message |
| POST | `/api/threads/:id/ask` | `{ prompt, commit, userMessageId?, assistantMessageId? }` → `{ answer, committed }` |
| POST | `/api/threads/:id/metadata` | force regen tags/description/embedding — **v2, off by default**; 503 unless `THREADZ_METADATA=1` |
| PUT | `/api/images/:hash` | store a photo: raw JPEG bytes, `:hash` = its sha256 hex. The body is re-hashed and must be a JPEG (magic bytes) ≤ 8MB, else 400/415/413. Idempotent: a replay changes nothing (`{ ok, stored }`) |
| GET | `/api/images/:hash` | the JPEG, `cache-control: immutable`; 404 if unknown |
| GET | `/api/threads/:id/related` | top-5 cosine-similar threads — **v2, not used by the UI**; 503 unless `THREADZ_METADATA=1` |

### Metadata generation (v2, off by default)

Generated description, tags, embeddings and "related threads" were tried for v1 and dropped: there was no
solid place in the UI for them, and the output was too weak to trust. The list row shows only title and
date; search matches only titles and note text; there is no tags feature. The columns, `metadata.ts` and the
`/related` endpoint stay in the codebase for a v2 revisit (see `backlog.md`) but do nothing by default. Set
`THREADZ_METADATA=1` to turn generation back on (needs Ollama, see Prerequisites) — appends then trigger it
fire-and-forget, and `POST /api/threads/:id/metadata` / `GET /api/threads/:id/related` work instead of
answering `503`.

### Local mode (work with no backend)

The status pill (Settings → Sync) shows where you are: **Live** (● reading/writing main) or **Local** (■ this device
is the source of truth; a hatched bar runs across the top; a ping means main is reachable). Open
the pill for the connection dialog.

- **Auto-detach.** While live, the app keeps a full copy of main on the device (`threadz-local`,
  plus per-thread hashes of what it last agreed on with main). If main becomes unreachable, the
  app switches to that copy by itself — a failed write is retried on the device, never dropped —
  and says so once. **Work locally** does the same on purpose. Claude ("Ask") needs main, so the
  Ask toggle is not offered while local.
- **Coming back is never automatic.** A "Main is reachable" banner offers Review; going live is a
  button. It runs: pull main's changes into the device copy → send everything pending in one
  request → re-read what was sent and prove every local note is on main → compare hashes. Only
  when both sides agree does the mode flip. Every step is idempotent, so a crash or retry resumes.
- **Conflicts** are resolved without asking; whichever side has content wins, so a delete never
  destroys the other side's edits. Deleted on main + untouched here → removed here (copy kept).
  Deleted on main + edited here → kept and re-sent. Deleted here + edited on main → brought back.
  Notes merge by id (append-only), so they never conflict. A note (annotation) *can* be deleted —
  one per message, own delete endpoint — and that delete is versioned the same way: refused (content
  kept) if the note changed since this device last saw it. The dialog reports what happened.
- **Data safety.** The device store is never cleared wholesale; pending rows are flagged `dirty`
  until main acknowledged them; a delete keeps a copy in `trash`; a rolling safety copy is taken
  before every sync; drafts persist per thread. **Export/Import** writes/reads a JSON backup
  (union merge). The app asks the browser for persistent storage; on iOS use the installed
  home-screen app so Safari's 7-day eviction doesn't apply.
- **Main backs itself up** before applying a sync: `backups/threadz-<time>.sqlite` next to the
  database (`THREADZ_BACKUPS` to relocate, `THREADZ_KEEP_BACKUPS`, default 20). To revert main,
  stop the backend and copy one over `threadz.sqlite`.
- **Photos** are sent first, one idempotent `PUT` each, before the atomic sync (see below).
- `VITE_LOCAL=1` builds default to local mode and skip the backend presence stream (static hosting, see "Publish to GitHub Pages").

### Starting and naming threads

`+` (or `n`) makes a thread at once, called `Thread: 004` (threads + 1, at least three digits; a number a delete left
taken is skipped) and opens it. There is no form. **Name a thread from its first note** (Settings, on by default)
renames it when that note is sent or edited, using [yatefca](https://www.npmjs.com/package/yatefca): keyword
extraction, no model, so it also works offline and in local mode. It only replaces a title nobody chose (the
placeholder, or exactly what it derived from the previous first note) and does nothing when the note is too thin to
name. The pencil-sparkles button on a row does the same on demand from all of the thread's notes, and does replace a
name you typed.

**Capture deep link.** `?capture=1` opens the same way as `+`/`n` and focuses the composer — the installed PWA's
long-press icon menu offers it as "New note" (`vite.config.ts`'s manifest `shortcuts`). Unverified on iOS: WebKit
won't raise the keyboard from this without a direct tap, so it may land focused but silent until one tap.

### Settings

The gear in the bottom tab bar (Threads · Todos · Bin · Settings) flips the sidebar to Settings: the auto-name switch, a Backend URL override (see
"Reach the backend + Ollama from the phone"; hidden on a `VITE_LOCAL` build with no backend to point at), and the
speech model. They are per device (`localStorage`), never synced.

### Open todos

The list icon beside the gear flips the sidebar to every todo across every thread, newest first, tap to jump to
its thread, scrolled straight to that message and briefly highlighted (a plain CSS flash — `.message-highlight`
in `styles.css` — not Motion, nothing enters or leaves the tree). A sidebar entry is one of three shapes
(`lib/todos.ts`'s `Todo`, a discriminated union on `kind`):

- **A single line.** The legacy `- [ ] `/`- [x] ` checkbox (loose, matches anywhere in a line), or `/todo <text>`
  (the older `@/todo` still works) — a command anchored to the start of a line, closed by wrapping it in real markdown strikethrough
  (`~~/todo <text>~~`). Text is the only source of truth; tapping the checkbox rewrites that one line in place
  (open<->closed) through the same `editMessage` a normal edit uses.
- **A titled group.** `/todos <title>` followed immediately by a run of list-item lines (`- `, `- [ ]`, `- [x]`
  — stops at the first blank line or the first line that isn't a list item) renders as one card under `<title>`
  with its own items underneath, each independently tickable. A plain `- item` with no checkbox parses as open;
  ticking it adds the checkbox rather than requiring one up front. Still text-is-truth: every toggle is the same
  `editMessage` rewrite, just targeting that item's own line.
- **A flagged message.** The message's own ⋯ menu ("Add to Todos" / "Remove from Todos") flags the *whole
  message* as a todo without inserting any `/todo` text — a second, non-textual mechanism for the same sidebar
  outcome (see `inspiration.md`'s "Commands: a content primitive"). State lives in `meta.todo: { done: boolean }`
  on the message (`backend/schemas.ts`'s `MessageMeta`), its own small sync-safe route
  (`PATCH /api/threads/:id/messages/:mid/meta`, merges into `meta` rather than replacing it) rather than a
  content edit — the sidebar shows truncated message content with its own checkbox, and toggling it calls
  `lib/api.ts`'s `toggleMessageTodo`/`removeMessageTodo` directly, never `editMessage`.

Closed todos (lines, group items, and flagged messages alike) are hidden by default; a header toggle shows them
alongside a count of each. Lines and groups are pure derived data — `frontend/src/lib/todos.ts` scans messages
already pulled into the device copy (`lib/local.ts`'s `exportSnapshot`) — so neither needed a new store or a sync
change. The flagged-message shape is the one real addition: `meta` already rode along in `SyncPayload`, but main
never actually applied an incoming `meta` to a message it already had, and `threadHash` never reflected a
meta-only change either, so a flag set on one device could silently never reach (or be pulled by) another — both
fixed (`meta`'s own `metaEditedAt` clock, mirroring `editedAt`'s shape without treating a flag as a content edit;
see `backlog.md`). The jump itself reuses the `?capture=1` deep-link pattern: a row's click calls `App.tsx`'s
`openThreadAt(threadId, messageId)` (also `history.pushState`s a shareable `?thread=<id>&msg=<id>` pair) which
opens the thread and hands `ThreadView` a `scrollToMessageId`; once that message's index is known in the
already-virtualized message list (`@tanstack/react-virtual`), it calls the virtualizer's `scrollToIndex`. The
same query-param pair is parsed once on mount for a direct link, through the same `openThreadAt`.

### Photos in notes

The composer's image button (also paste / drop) takes a photo, shrinks it in the browser to ≤1600px on the
long edge as a JPEG (~0.8; every browser can encode JPEG, Safari can't do WebP/AVIF) and puts
`![](img:<sha256>#<w>x<h>)` in the note. The `#WxH` reserves a grey box of the right shape; the bytes are
only looked up when it scrolls into view. The note stays plain markdown — sync, thread hashes and edits
don't know images exist.

- **Images are never in a backup or snapshot, on purpose.** Device: their own IndexedDB database
  (`threadz-images`, `lib/images.ts`), which `exportSnapshot`, the rolling safety copy, Export/Import and the
  mirror never read. Main: plain files in `THREADZ_IMAGES` (default `images/` beside the database), not SQLite
  rows, so neither `VACUUM INTO` backups nor `/api/snapshot` carry them. There is no image backup at all: a photo
  is content-addressed and immutable, so a copy on the device that took it plus a copy on main is the whole
  story. `KEEP_BACKUPS` stays for the (cheap, text-only) database backups: they protect against a bad sync.
  Consequence: an **Export backup** file holds references, not pictures.
- **Not lost.** A photo taken on the device stays flagged `dirty` until main acknowledged its `PUT`, and is
  never deleted by anything. While live it is sent immediately (and retried on every pull); `syncNow` sends
  any left before the note that shows it. Photos from main are cached on the device on first view (live);
  offline, an uncached one stays a grey box.
- **Orphans are collected.** Main deletes files no note (or kept edit) mentions once they are older than 7 days
  (at startup, then daily). The device deletes clean cached images no note in the device copy mentions (a day
  after caching); a `dirty` image is never deleted. Local mode fetches photos on demand, so an offline photo
  never viewed while live is a grey box — a deliberate choice until real use shows the volume.
- **Deliberate limits.** No zip export (that would be an image backup), no alt text/captions (the note format is
  `![](img:<hash>#WxH)` only), no streaming upload (one ≤8MB `PUT` is fine at ≤1600px JPEG).

### Load-bearing decisions

- **Append-only, edits keep history.** Messages are never deleted or reordered. Your own notes can
  be edited in place, but the previous text is kept in the message's `edits` (`[{content, at}]`),
  and edits sync in both directions: newest text wins, the other version stays in the history.
  Thread renames are last-write-wins (`renamedAt`).
- **Idempotency keys.** Every append carries a client UUID; the backend dedupes on it
  (primary key). Retrying a flaky send is safe.
- **One model seam.** All Claude calls go through `askModel()` in `backend/model.ts` —
  the plug point for a future routing gateway.
- **Main is the brain, phones are shadow clones.** Anything heavy (embeddings, comparing notes, batch jobs,
  Claude) runs on main; a phone captures, reads and merges back, and runs no LLM. There is no hosted backend and
  none is planned.
- **Nothing auto-syncs.** Reconnecting shows a "Main is reachable" banner; the user reviews and goes live.
- **Claude sees only the thread.** `askModel()` runs with no tools, no MCP servers and an empty working
  directory, so a prompt can never read the machine it runs on.

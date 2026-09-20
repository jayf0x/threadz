# Threadz — Personal Brain POC (v1)

A thread-based chat PWA backed by one shared local-network service. Threads live in one
place; any device on the LAN can read and append; offline captures queue and never send
themselves. See `brain-poc-handover.md` for the vision and invariants; `backlog.md` for
open questions and deliberate scoping.

## What's here

```
backend/    Bun + bun:sqlite service. HTTP API, model seam, metadata + embeddings.
frontend/   React 19 + Vite + Tailwind v4 PWA. IndexedDB mirror + outbox, on-device whisper.
tests/      bun test — invariant + HTTP e2e tests.
scripts/    smoke.sh — curl-based end-to-end check against a running backend.
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Ollama](https://ollama.com) running, with models pulled:
  ```bash
  ollama pull qwen3.5:0.8b       # tags + descriptions
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
`http://<lan-ip>:5173` on the phone gets none of them (`localhost` is exempt). Easiest fix is
Tailscale on both devices; `tailscale serve` gives each port a real cert:

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

(Only needed because metadata/embeddings run backend→Ollama; the phone talks only to the
backend.)

## Test

```bash
bun test                    # invariants + HTTP e2e (stubbed model)
bun run smoke http://localhost:8787   # real end-to-end against Ollama (+ Claude if logged in)
bun run typecheck
```

## API (JSON, except the image bytes)

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
| POST | `/api/threads/:id/ask` | `{ prompt, commit, userMessageId?, assistantMessageId? }` → `{ answer, committed }` |
| POST | `/api/threads/:id/metadata` | force regen tags/description/embedding |
| PUT | `/api/images/:hash` | store a photo: raw JPEG bytes, `:hash` = its sha256 hex. The body is re-hashed and must be a JPEG (magic bytes) ≤ 8MB, else 400/415/413. Idempotent: a replay changes nothing (`{ ok, stored }`) |
| GET | `/api/images/:hash` | the JPEG, `cache-control: immutable`; 404 if unknown |
| GET | `/api/threads/:id/related` | top-5 cosine-similar threads — **v2, not used by the UI** |

### Local mode (work with no backend)

The footer pill shows where you are: **Live** (● reading/writing main) or **Local** (■ this device
is the source of truth; a hatched bar runs across the top; a ping means main is reachable). Open
the pill for the connection dialog.

- **Auto-detach.** While live, the app keeps a full copy of main on the device (`threadz-local`,
  plus per-thread hashes of what it last agreed on with main). If main becomes unreachable, the
  app switches to that copy by itself — a failed write is retried on the device, never dropped —
  and says so once. **Work locally** does the same on purpose. Claude ("Ask") needs main and is
  disabled while local; local threads carry no tags/description until they reach main.
- **Coming back is never automatic.** A "Main is reachable" banner offers Review; going live is a
  button. It runs: pull main's changes into the device copy → send everything pending in one
  request → re-read what was sent and prove every local note is on main → compare hashes. Only
  when both sides agree does the mode flip. Every step is idempotent, so a crash or retry resumes.
- **Conflicts** are resolved without asking; whichever side has content wins, so a delete never
  destroys the other side's edits. Deleted on main + untouched here → removed here (copy kept).
  Deleted on main + edited here → kept and re-sent. Deleted here + edited on main → brought back.
  Notes merge by id (append-only), so they never conflict. The dialog reports what happened.
- **Data safety.** The device store is never cleared wholesale; pending rows are flagged `dirty`
  until main acknowledged them; a delete keeps a copy in `trash`; a rolling safety copy is taken
  before every sync; drafts persist per thread. **Export/Import** writes/reads a JSON backup
  (union merge). The app asks the browser for persistent storage; on iOS use the installed
  home-screen app so Safari's 7-day eviction doesn't apply.
- **Main backs itself up** before applying a sync: `backups/threadz-<time>.sqlite` next to the
  database (`THREADZ_BACKUPS` to relocate, `THREADZ_KEEP_BACKUPS`, default 20). To revert main,
  stop the backend and copy one over `threadz.sqlite`.
- **Photos** are sent first, one idempotent `PUT` each, before the atomic sync (see below).
- `VITE_LOCAL=1` builds default to local mode and skip the backend presence stream (static hosting).

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
- Orphans (a photo whose note was never sent or was deleted) are harmless and not collected.

### Load-bearing decisions

- **Append-only, edits keep history.** Messages are never deleted or reordered. Your own notes can
  be edited in place, but the previous text is kept in the message's `edits` (`[{content, at}]`),
  and edits sync in both directions: newest text wins, the other version stays in the history.
  Thread renames are last-write-wins (`renamedAt`).
- **Idempotency keys.** Every append carries a client UUID; the backend dedupes on it
  (primary key). Retrying a flaky send is safe.
- **One model seam.** All Claude calls go through `askModel()` in `backend/model.ts` —
  the plug point for a future routing gateway.
- **Source-agnostic store.** `source` is a column, not a shape. Obsidian / `~/.claude`
  importers become additional writers.
- **Nothing auto-sends.** Reconnecting shows a pending banner; the user hits "Send now".

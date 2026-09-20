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

## API (all JSON)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, model }` |
| GET | `/api/threads?q=&sort=updated\|created\|title` | list / search |
| POST | `/api/threads` | create `{ title, seed?, id? }` |
| GET | `/api/threads/:id` | `{ thread, messages }` |
| DELETE | `/api/threads/:id` | delete thread + messages |
| POST | `/api/threads/:id/messages` | idempotent append `{ id, content, role?, meta? }` |
| POST | `/api/threads/:id/ask` | `{ prompt, commit, userMessageId?, assistantMessageId? }` → `{ answer, committed }` |
| POST | `/api/threads/:id/metadata` | force regen tags/description/embedding |
| GET | `/api/threads/:id/related` | top-5 cosine-similar threads — **v2, not used by the UI** |

### Load-bearing decisions

- **Append-only.** Committed messages are never edited/reordered. Only mutable state is the
  device outbox (`frontend/src/lib/db.ts`).
- **Idempotency keys.** Every append carries a client UUID; the backend dedupes on it
  (primary key). Retrying a flaky send is safe.
- **One model seam.** All Claude calls go through `askModel()` in `backend/model.ts` —
  the plug point for a future routing gateway.
- **Source-agnostic store.** `source` is a column, not a shape. Obsidian / `~/.claude`
  importers become additional writers.
- **Nothing auto-sends.** Reconnecting shows a pending banner; the user hits "Send now".

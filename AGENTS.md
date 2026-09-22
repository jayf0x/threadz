# AGENTS.md

## What this is

Threadz — personal-brain POC. Read `README.md` (API, local mode, photos, load-bearing decisions) and
`backlog.md` (open questions) before changing behavior.

## Mental model

- One backend, one SQLite file, many devices. The frontend keeps a **disposable** mirror of main
  (`threadz` IndexedDB, wholesale-replaced on fetch) and a **durable** device copy (`threadz-local`,
  see Local mode below).
- The backend stores plain threads and messages; nothing in the schema depends on where a note came from.

## Commands (bun only, never npm/yarn/pnpm)

| | |
|---|---|
| `bun run dev:backend` / `dev:frontend` | run each side |
| `bun test` | invariant + e2e tests |
| `bun run smoke <url>` | curl e2e against a live backend |
| `bun run pages:build` / `pages:deploy` | build the local-only PWA for `/threadz/` / trigger the manual Pages workflow |
| `bun run typecheck` | both packages |
| `bun run check` | typecheck + Biome (warnings fail) + token lint + tests = "green" |

Verify before claiming done: `bun run check`, then `bun run --cwd frontend build`.
Typecheck passing says nothing about whether the UI renders.

## Conventions

**Enforced by `bun run check`** (fix the code, don't work around it): no `any` (a `biome-ignore` with a
reason is the only exit), no `../` imports, no reaching into `features/<x>/*` except its `index.ts`, unused
imports/vars, formatting + import order, raw colours (`// threadz-allow-raw-color` for a real one-off), and
`noUncheckedIndexedAccess`.

**Guidelines** (not enforced; use judgment): file order (imports, types, exported component, its helpers in
call order, constants; in a component state, handlers, effects last); effects only for syncing with something
external, never for derived state; fetching and transforming data live in a hook or pure function, not in JSX;
extract a helper when the same code shows up a third time; delete dead code and comments that restate the code;
primary actions (send, add, create) use an icon once an established one exists for the action, not a text
label — reserve text labels for actions without an obvious icon, or where the icon alone would be ambiguous.

- `export const` arrow functions. PascalCase component files, camelCase modules.
- Layout: `components/ui/` primitives · `features/<name>/` (other features import only its `index.ts`) · `lib/`.
  `@/` across folders, `./` within one. See README "Structure & conventions".
- Semantic color tokens only in components — never a hardcoded color.
- `frontend/src/lib/**` holds the sync, merge and image logic the rules below depend on: change it with care.
- All Claude calls go through `askModel()` in `backend/model.ts` (via the Claude Code
  SDK / local CLI auth — no API key). Nowhere else. It runs Claude with no tools, no MCP servers and an empty
  working directory: the model sees only the thread text it is sent, never the device's files.
- **Local mode** (`lib/local.ts`, `replica.ts`, `handoff.ts`, `mode.ts`, `status.ts`): `threadz-local`
  is the device's authoritative copy of main. While live it is kept warm by `pullMain()` (hash
  compare vs `base`, fetch changed threads, union); `api.ts` `via()` auto-detaches to it when main is
  truly unreachable. Never clear it wholesale, never auto-switch back to live, and move data only
  through `handoff.syncNow()` (pull → one `/api/sync` push → verify → compare hashes). Merges are
  unions by message id; delete-vs-edit is "content wins". The `threadz` mirror stays disposable.
  Keep `remoteApi` and `localApi` signature-identical. Local mode offers no Ask (Claude lives on main). A
  legacy `outbox` IndexedDB store is drained once into the device copy by `replica.ts`; nothing writes it.
- **Images** (`lib/images.ts`, `imageSync.ts`; `backend/images.ts`): a note holds only `![](img:<sha256>#WxH)`.
  Bytes live in their own IndexedDB (`threadz-images`) and, on main, as files in `THREADZ_IMAGES` — never in
  `exportSnapshot`/`saveBackup`/`mergeSnapshot`/Export, never in SQLite, `backupDb()` or `/api/snapshot`. A `dirty`
  image is never deleted; it is `PUT` to main before `/api/sync`.
- "Related threads" (`/api/threads/:id/related`) is a v2 endpoint and not in the UI; see `backlog.md`.
- Request bodies are validated with Zod schemas in `backend/schemas.ts`; a bad body is a 400, never a 500.
- Metadata generation is fire-and-forget after each append (no queue) — off by default; set `THREADZ_METADATA=1`
  to turn it on (v1 dropped generated description/tags/embeddings/related from the UI; the code stays for v2).
- Tests cover logic with branching and the sync/merge/image rules, plus one HTTP round-trip that cleans up after
  itself. No per-component suites; a change that touches none of that needs no new test.

# AGENTS.md

## What this is

Threadz — personal-brain POC. Read `brain-poc-handover.md` (vision + MUST invariants) and
`backlog.md` (open questions) before changing behavior.

## Mental model

- One backend, one SQLite file, many devices. The frontend keeps a **disposable** local
  mirror (wholesale-replaced on fetch) and a **durable** outbox (unsent drafts).
- The backend is source-agnostic: a "thread"/"message" has a `source` column, never
  source-specific structure.

## Commands (bun only, never npm/yarn/pnpm)

| | |
|---|---|
| `bun run dev:backend` / `dev:frontend` | run each side |
| `bun test` | invariant + e2e tests |
| `bun run smoke <url>` | curl e2e against a live backend |
| `bun run typecheck` | both packages |

Verify before claiming done: `bun run typecheck`, then `bun run --cwd frontend build`.
Typecheck passing says nothing about whether the UI renders.

## Conventions

- `export const` arrow functions. PascalCase component files, camelCase modules.
- Semantic color tokens only in components — never a hardcoded color.
- `frontend/src/lib/**` and `frontend/src/hooks/**` hold the invariant-critical logic and
  are tested — change with care, keep the hook contracts stable.
- All Claude calls go through `askModel()` in `backend/model.ts` (via the Claude Code
  SDK / local CLI auth — no API key). Nowhere else.
- "Related threads" (`/api/threads/:id/related`) is a v2 endpoint — do not wire it into the UI.
- Metadata generation is fire-and-forget on commit. No queues, no tiers.
- Tests: a handful around the §3 invariants + one HTTP round-trip that cleans up after
  itself. "Zero new tests" is valid for a change that doesn't touch an invariant.

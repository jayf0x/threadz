# Task: Threadz v2 wave 9 — main-derived tables and the embeddings eval

**Start only after the device checklist in `backlog.md` passes on a real iPhone with the `real` seed.**

Follow AGENTS.md "Working in waves". Context: docs/direction.md, Round 6 ("Main-derived data") and Round 8;
inspiration.md's "Eval before choosing models"; backlog.md's related-threads entry.

## Step 0 (ask the user)

1. Derived tables:
   - the unit that gets replaced (per kind, or per thread);
   - a generation id, so the phone swaps a whole set at once;
   - the endpoint (part of `/api/changes`, or `/api/derived`).
2. Embedding runtime and candidates. Ollama on main is the default runtime. Pick 2–3 models to compare. These are
   options, not decisions.
3. What gets embedded: a whole note or chunks of it, and never generated text in the embedding input.
4. The eval set: the user labels about 40 "same thing" pairs and about 10 look-alikes from their own notes. How: a
   JSON file the user fills in, or a small labelling screen?

## Phase 1 (alone, then freeze)

The `derived_*` plane:
- tables written only by main;
- sync from main to the phone only, swapped by generation;
- read-only on the phone;
- rebuildable from scratch.

## Phase 2 (parallel)

| Area | Scope |
|---|---|
| Embedding pipeline | main writes `derived_embeddings` behind a flag, one run per candidate model |
| Eval harness | `bun run eval`: recall@5 for each model × each granularity, over the user's labelled set; writes a results table |
| Labelling | whatever Step 0 decided |

## Out of scope

Related notes, hybrid search and themes. Those come after the user picks a model from the eval results.

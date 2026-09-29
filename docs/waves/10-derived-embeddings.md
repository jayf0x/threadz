# Task: Threadz v2 wave 10 — main-derived tables and the embeddings eval

**Start only after wave 9 lands and the device checklist in `backlog.md` passes on a real iPhone with the `real` seed.**

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

## Corrections from wave 9 planning (apply to Step 0)

5. **Where the eval notes come from.** Not only the user's own notes: the `real` seed is synthetic and can't carry
   "same thing" pairs. Ask: the user's exported `.sqlite` (labelled by hand), or a generated set of paraphrase pairs
   plus look-alikes to smoke-test the harness first, then the user's labels for the real verdict. Default: both.
6. **Derived tables split in two.** `derived_*` is not one plane: (a) **main-only** (embeddings, generation logs,
   anything only main reads); (b) **main → phone** (only what a phone lens reads, e.g. related-note ids), swapped by
   generation. Phase 1 defines both and their schema version (wave 9's migration runner covers them).
7. **Does meaning-based search work offline?** Only if the query can be embedded on the phone. Ask: (a) online only
   (needs main, falls back to keyword search when `unreachable`); (b) small on-device model in the worker; (c) phone
   stores note vectors and main embeds the query. Default: (a), keyword search stays the offline path.

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

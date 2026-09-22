# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices are in `README.md`; ideas that are
not committed to yet are in `inspiration.md`. What is left is v1 work, v2, or can't be settled without a real phone.

## Next — v1

Goals: capture an idea in seconds without opening anything else, replace Obsidian and chat apps, stay 100% local.
Anything AI-generated (descriptions, tags, themes, "similar to x") is v2 for now.

AI metadata is out of v1: gated behind `THREADZ_METADATA` (off by default — see `.env.example`), `ThreadRow`/search
show/match title and note text only, `description`/`tags`/`embedding` stay nullable fields nothing new depends on.

`Popover` and `Menu` (`components/ui/`) and a shared `MessageInput` (editor + draft + image attach + send, keyed
per target) are built and not yet wired into anything; `Composer` already wraps `MessageInput`. The remaining three
entries build on each other and touch the same files (`local.ts`, `api.ts`, `db.ts`, `ThreadView`) — build in this
order, one at a time, so parallel work doesn't collide: message menu → copy (without annotations) → annotations
(extends copy).

- **Message menu.** One ⋯ button per message holds every secondary action: Annotate, Copy thread from here, and the
  existing per-message actions that belong there (edit). Always visible on touch, on hover on desktop (the rule the
  thread-row actions already use); no row of icons per message. Thread-row actions (rename, regenerate title,
  delete) stay as they are. An annotated message shows a count chip in its meta line (next to the voice icon) that
  expands the annotations inline, the same pattern as "edited" — a note only reachable through the popover would
  never be found again.
- **Copy thread from a message.** On A:N, create thread B as an identical copy of A from its first message up to
  and including N. A is unchanged. Build this before annotations; add annotation-copying in the next entry.
  - New ids for the thread and every message. Original `createdAt`, edits and other row properties are kept.
    Images stay references (`img:<sha256>`), no bytes are duplicated. `description`, `tags` and `embedding` stay
    null. Title is `Copy: <original title>` ("Copy: Copy: X" is fine). B opens afterwards.
  - One call in `remoteApi` and `localApi`: one transaction on main, IndexedDB in local mode. The caller (not the
    server) mints B's id once, before the request, and reuses it on any retry — the same pattern `createThread`
    already uses for its client id, so a double tap or a retried request cannot create two copies. Message ids
    derive deterministically from B's id plus each original message's id, so the same call replayed produces the
    same ids again instead of duplicating (plain new/random ids otherwise — decided 2026-09-22: no provenance
    tracking, see below); the composer path's appended note (see Entry points) gets the same treatment — its id
    derives from B's id too (e.g. `note-<B.id>`), not a freshly minted UUID, so retrying that call can't leave two
    copies of the typed text either. Works offline; B syncs like any thread.
  - Entry points: "Copy thread from here" in the message menu, and a ⋯ menu beside Send in the composer that
    copies at the last message *and* appends the typed text as B's next note, in the same call (not a follow-up
    request — a second call reopens the half-created-thread problem, and could lose the text if it failed). No
    always-visible Copy button next to Send, so no mistap while capturing. That menu is the same `Menu` primitive
    and takes future secondary actions.
  - No `copiedFrom` / `forkedFrom` (decided, see below): a copy's origin is not recoverable later, and a copy will
    look like an independent thread to search/trend-detection.
  - Tests: A untouched; B ids new (a repeated call must not duplicate — reuse the client-minted id the same way
    `createThread` does), `createdAt` kept, images shared, live and local, an offline copy syncs.
- **Annotations.** A note attached to one message: text required (an image-only annotation counts as text — the
  content is markdown either way), images optional. Opened from the message menu in a popover holding a
  `MessageInput`; a message's existing annotations render as markdown, ordered by `(createdAt, id)`. Adding one
  bumps the thread's `updatedAt`, the same as editing a message does.
  - Real schema, no `z.unknown()`: the same fields as a message minus `role` (only the user writes annotations in
    v1; add it back if an AI-authored annotation happens later) — id, content, createdAt, editedAt, edits — plus
    the thread and message it belongs to, and no annotations of annotations. One base schema shared with messages:
    Zod in `backend/schemas.ts`, a SQLite table with cascade on thread delete, a TS type.
  - Backend and sync: add (idempotent by client id) and edit (history kept like messages) endpoints; `annotations`
    in the `/api/sync` payload; union merge by id, edits newest wins. The thread hash must only grow a new segment
    for annotation ids/edit times **when the thread has at least one** — otherwise every existing thread's hash
    changes on upgrade and every device's stored `base` mismatches, which shows as spurious "main changed" and
    refuses pending deletes.
  - Frontend, and everywhere a message can be dirty, deleted or restored, annotations must behave the same way —
    they are their own rows, not part of a message's own dirty flag:
    - the `threadz` mirror and `threadz-local` stores need their own object store (DB version bump plus migration);
      `remoteApi` and `localApi` stay signature-identical.
    - `applyRemoteDelete` in `local.ts` currently follows main's delete of a thread unless the thread or one of its
      messages is dirty; an unsynced annotation on an otherwise-clean message must count too, or it is silently
      destroyed.
    - the same for the "N↑" pending-changes count, the `handoff` verify step, and trash/restore.
    - `applySync`'s `missing` case (a note whose thread main no longer has) needs the same handling for an
      annotation whose message main lacks: skip and retry, don't drop.
    - `exportSnapshot`, `mergeSnapshot`, `parseSnapshot` and trash carry annotations; an old backup file without
      them still imports.
    - Copy: annotations on a copied message are copied too, with their message reference remapped to the new id.
      No metadata question here — `description`/`tags`/`embedding` stay null on B either way (metadata generation
      is v2/flag-gated off by default in v1; see the Copy entry above), nothing copy-specific to decide.
  - Not part of Ask context or search for now.
  - Images: both orphan-GC scans (`backend/images.ts` `referencedHashes`, `frontend/src/lib/images.ts`
    `gcDeviceImages`) read only `messages.content`/`edits` today — an image that only appears in an annotation
    would be collected as an orphan. Both need to scan annotation content/edits too, and annotations need to be
    kept in trash the way messages are.
- **Capture without a title, the rest.** `+` / `n` makes `Thread: NNN`, opens it, retries auto-naming it from every
  note (not just the first) until it sticks, and reuses an empty untouched placeholder instead of piling up another
  — done. Still missing: opening the app, or a `/capture` deep link / PWA shortcut, landing straight in a focused
  composer — note for the real-phone list: iOS will not raise the keyboard from a programmatic focus outside a tap,
  so a deep link alone may land you in the thread with the keyboard still closed.
- **Search.** Search is a literal `LIKE` (`db.ts`): no ranking. SQLite (Bun's bundled 3.43.2) has FTS5, but its
  default `unicode61` tokenizer only matches whole tokens — confirmed: it finds 0 hits for `izing` against
  "resizing", where today's `LIKE` matches. Use the `trigram` tokenizer instead, which keeps mid-word matching (1
  hit, confirmed). Local mode and the static Pages build still use the plain JS substring search, so live and
  local results would differ in ranking even after this; unifying them behind one shared TypeScript scorer instead
  of running FTS5 on main and a JS twin everywhere else is a reasonable follow-up, left to the implementer.
- **Todos.** Nothing gathers `- [ ]` across threads. Ship a **read-only** "Open todos" view first (a query over
  messages, links to the note) — not tick-in-place: ticking a box is a content edit, so it stores a full-text
  version in `edits`, and two devices ticking different boxes offline would silently lose one tick (newest text
  wins). Independent of search; can be built any time.

**Decided 2026-09-22:** no `copiedFrom` / `forkedFrom` provenance for Copy. Simpler now; a copy's origin cannot be
recovered later if this turns out to matter (e.g. for collapsing near-duplicates once search/trend-detection
exist).

## v2 features (deferred by design)

- **Everything AI-generated.** Descriptions, tags, embeddings and the views for them: tried in v1, no place for it
  yet (ideas for a details view and for tags in `inspiration.md`).
- **Related threads / "similar to x".** `GET /api/threads/:id/related` exists and is unused. It failed for a fixable
  reason: one vector per thread, built in `metadata.ts` from `title + description + tags + the first 2000 chars`
  of the transcript, so a growing thread drifts away from its vector. Try per-note (or chunk) embeddings, keep
  generated text out of the embedding input, thread score = best/mean note match; judge on real data first. A
  semantic fallback for search would use the same embeddings. A graph version (entity extraction + community
  detection) comes after.
- **Vision captioning** for image-only notes (they get metadata from the title alone).
- **WebGPU whisper decode** where available (much cheaper per utterance; not on iOS).
- **Ask on the phone.** Capture-only while local. Options: queue asks until main is reachable, or
  paste an API key (billed, key lives on the phone).
- **Local-mode policy, once real use shows the need:** auto-sync/go-live when main returns (needs the
  two-probe hysteresis in `status.ts` as a flap guard), a "review before sync" list for conflicts
  (only if "content wins" ever surprises), replicating all/recent photos to the device, in-app restore of
  `trash` / safety copies / main's backups (today: re-import via Import, or copy a backup over `threadz.sqlite`).

## Blocked on a real phone

Everything is verified headless in Chrome (desktop + 390px); none of this has run on an iPhone.

- **Popovers and the message menu on iOS:** positioning with the keyboard open, tap targets, dismissal. Only
  testable on a device.
- **Deep-link straight into capture:** iOS does not raise the keyboard from a programmatic focus outside a tap, so
  this may still need a manual tap once landed.
- **Images:** iOS HEIC picker, camera capture, canvas memory on old iPhones; a ~600px thumbnail tier if
  decoded-bitmap memory kills the iOS tab with many images in one thread; `navigator.storage.persist()` on
  the installed PWA (photos on a not-yet-synced device exist nowhere else); `crypto.subtle` on plain `http://`.
- **Voice, iOS background limit (won't fix in the PWA).** WebKit suspends the mic + AudioContext seconds
  after screen-lock. True screen-off needs a Capacitor/native shell.
- **Voice needs HTTPS on the phone** (`getUserMedia` is blocked on `http://<lan-ip>`); the UI says so.
- **Voice model choice and quality.** Default `whisper-tiny.en`; test tiny vs base (and `small` on desktop)
  at hour-scale on the phone, and `base`/`small` for Dutch etc. (`tiny` is weak outside English).
- **Voice tuning constants** in `engine.ts`: `REDEMPTION_MS` (800), `MAX_UTTER_S` (25), `IDLE_UNLOAD_MS` (3 min).
- **First-run model download** (~40MB + onnxruntime wasm): confirm it is runtime-cached and dictation works
  offline afterwards.
- **Local-mode timing:** whether the 2-probe detach (15s interval + `online`/`focus`) feels right on a flaky
  Wi-Fi handoff. The "Thread not found" state has never been opened in a browser.

# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices are in `README.md`; ideas that are
not committed to yet are in `inspiration.md`. What is left is v1 work, v2, or can't be settled without a real phone.

## Next — v1

Goals: capture an idea in seconds without opening anything else, replace Obsidian and chat apps, stay 100% local.
Anything AI-generated (descriptions, tags, themes, "similar to x") is v2 for now.

The first five entries belong together: what the list shows, the shared components, then the message menu,
annotations and copy built on them.

- **Take AI metadata out of v1.** Tested, does not belong in v1 (no solid place in the UI, output too weak).
  - The list row shows title and date only: drop description and tags from `ThreadRow.tsx`. No tags feature (typing
    or showing) until there are 20+ threads.
  - Search matches titles and note text only: drop the description/tags clauses from `visibleThreads.ts`, the local
    search in `local.ts` and `listThreads` in `backend/db.ts`.
  - Docs: `README.md` says the generated description, tags, embeddings and related threads were tried and do not
    belong in v1, and its mentions of them (intro, Ollama prerequisite, API table, local-mode note) match.
  - `description`, `tags` and `embedding` stay as nullable fields; nothing new may depend on them.
  - The background generation (`refreshMetadata` after each append) is switched off behind an env flag, off by
    default; the code stays for v2. With the flag off nothing calls Ollama, so it is no longer a prerequisite
    (README and `.env.example` say it is only needed with the flag on). Endpoints that need it
    (`POST /api/threads/:id/metadata`, `related`) answer with a clear "metadata is off" error. Tests that exercise
    generation turn the flag on.
- **Shared components** (needed by the next three entries).
  - `Popover` and `Menu` primitives in `components/ui/`: outside tap and Esc close them, keyboard reachable, usable
    on touch. Implementation is the developer's call.
  - `MessageInput`: the composer's editor, draft, image attach and send, extracted from `Composer.tsx` into a
    reusable component and hook with minor adjustments. `Composer` wraps it and keeps voice dictation and Ask. The
    draft key is per target (a thread, or a message for an annotation). No dictation in the annotation input for
    now: the mic engine is one shared session.
- **Message menu.** One ⋯ button per message holds every secondary action: Annotate, Copy thread from here, and the
  existing per-message actions that belong there (edit). Always visible on touch, on hover on desktop (the rule the
  thread-row actions already use); no row of icons per message. Thread-row actions (rename, regenerate title,
  delete) stay as they are.
- **Annotations.** A note attached to one message: text required, images optional. Opened from the message menu in a
  popover holding a `MessageInput`; the message's existing annotations render as markdown.
  - Real schema, no `z.unknown()`: the same fields as a message (id, role, content, createdAt, editedAt, edits) plus
    the thread and message it belongs to, and no annotations of annotations. No `meta` unless a field needs it. One
    base schema shared with messages: Zod in `backend/schemas.ts`, a SQLite table with cascade on thread delete, a
    TS type.
  - Backend and sync: add (idempotent by client id) and edit (history kept like messages) endpoints; `annotations`
    in the `/api/sync` payload; the thread hash includes annotation ids and edit times so changes are noticed;
    union merge by id, edits newest wins.
  - Frontend: the `threadz` mirror and `threadz-local` stores (DB version bump plus migration); `remoteApi` and
    `localApi` stay signature-identical; `exportSnapshot`, `mergeSnapshot`, `parseSnapshot` and trash carry
    annotations, and old backup files still import.
  - Not part of Ask context or search for now.
  - **Open:** how an annotated message shows it: a count chip that expands inline, or only inside the popover.
- **Copy thread from a message.** On A:N, create thread B as an identical copy of A from its first message up to
  and including N. A is unchanged.
  - New ids for the thread, every message and every annotation. Original `createdAt`, edits and other row properties
    are kept. Annotations are copied with their message reference remapped. Images stay references
    (`img:<sha256>`), no bytes are duplicated. `description`, `tags` and `embedding` stay null. Title is
    `Copy: <original title>` ("Copy: Copy: X" is fine). B opens afterwards.
  - One call in `remoteApi` and `localApi`: one transaction on main, IndexedDB in local mode. New ids derive from the
    new thread id plus the original id, so a retry or double tap cannot duplicate (like the `seed-<threadId>`
    note). Works offline; B syncs like any thread.
  - Entry points: "Copy thread from here" in the message menu, and a ⋯ menu beside Send in the composer that copies
    at the last message and makes the typed text B's first note (no always-visible Copy button, so no mistap next to
    Send). That menu is the same `Menu` primitive and takes future secondary actions.
  - Not stored: `copiedFrom` / `forkedFrom`. They cannot be added retroactively; see `inspiration.md`.
  - Tests: A untouched; B ids new, `createdAt` kept, annotations remapped, images shared, retry is idempotent, live
    and local, an offline copy syncs.
- **Capture without a title, the rest.** `+` / `n` now makes `Thread: NNN` and opens it, and yatefca names it from
  the first note. Still missing: opening the app (or a `/capture` deep link / PWA shortcut) landing in a focused
  composer, and an Inbox. Pressing `+` and walking away leaves an empty `Thread: NNN` behind; decide whether to
  create on the first note instead. yatefca gives nothing for a very short note.
- **Search and todos.** Search is a literal `LIKE` (`db.ts`): no ranking. Want SQLite FTS5. Nothing gathers `- [ ]`
  across threads; an "Open todos" view needs a query over messages, plus a decision on ticking a box (it is an edit,
  so it lands in `edits`).

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

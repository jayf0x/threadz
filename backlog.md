# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices are in `README.md`; ideas that are
not committed to yet are in `inspiration.md`. What is left is v1 work, v2, or can't be settled without a real phone.

## Now — pre-v2 polish (2026-09-22)

Feedback on the annotations/copy-thread round, plus a few items pulled forward from `inspiration.md`. Decided calls
made here (no further sign-off needed): annotations become **one per message** (upsert, not append — it's a small
note, not a sub-thread) and are **editable and deletable**; the visible word for them changes to **"Note"**, the
backend table/API keep the name `annotation` (not worth a rename); icon-over-text on primary actions is now a
standing convention (AGENTS.md); no reference/citation feature exists yet and none is being built now (parked in
`inspiration.md`'s "Annotation extensions" / "Staleness citations" for v2).

**Notes (annotations) are done**, backend and UI: one per message (DB-enforced unique index; a second create folds
into an edit), its own `DELETE` route, and `useThread.ts`'s `addAnnotation`/`editAnnotation`/`deleteAnnotation` all
wired up. In `ThreadView.tsx`'s `EntryRow`, a note is a quiet `StickyNote` icon next to the message's own ⋯ menu —
nothing shown until hover if there's no note yet, a muted-tinted icon if there is — that expands inline into a
compact editor with a CSS grid-rows transition (no new motion dependency; the next wave's animation library can
replace this if it wants to). Edit and delete (with a confirm, "no tombstone" per the API table) live in the
expanded view; the message-actions menu lost its old "Annotate" entry now that the icon is always there to open.

- **PWA can't reach a LAN backend.** `BACKEND_URL` (`lib/config.ts`) is computed once at load from
  `location.hostname` — correct if the page was ever loaded from the Mac's LAN IP, wrong if someone opened
  `localhost:5173` on the phone itself (which then means "this phone", not the Mac) and installed from there.
  Add a device-only **Backend URL** field in Settings (`lib/settings.ts`, `SettingsPanel.tsx`) that overrides the
  computed default; `api.ts` reads it per-request, not once at import time. Document in README under "Reach the
  backend + Ollama from the phone".
- **Edit mode can't remove markdown formatting.** `MarkdownEditor` (`features/editor/`) is a WYSIWYG surface
  (Milkdown Crepe) everywhere, including message-edit. There's no way to select "**bold**" and see the `**` to
  delete them. Give `MarkdownEditor` a raw mode — plain textarea bound to the same markdown string, same handle
  contract (`getMarkdown`/`setMarkdown`/`insertAtCaret`/`insertImage` as a text-insert) — and use it for editing an
  existing message. Build it generically enough that annotation-edit (below) can reuse it.
- **Motion.** Backend is fine as-is; the frontend reads static next to what the redesigned notes UI needs to feel
  like. Add a small animation library (research React Spring vs. Motion/Framer Motion vs. GSAP vs. plain CSS
  transitions first — several already cover this without a new dependency) and apply restrained, subtle motion to
  the popover, the notes UI and message entries. Don't turn this into a design-system rewrite; touch the existing
  large views/components, not every primitive.

## Next — v1

Goals: capture an idea in seconds without opening anything else, replace Obsidian and chat apps, stay 100% local.
Anything AI-generated (descriptions, tags, themes, "similar to x") is v2 for now.

AI metadata is out of v1: gated behind `THREADZ_METADATA` (off by default — see `.env.example`), `ThreadRow`/search
show/match title and note text only, `description`/`tags`/`embedding` stay nullable fields nothing new depends on.

`Popover`, `Menu` and `MessageInput` are built; `Composer` wraps `MessageInput`. Each of your own notes has a ⋯
(`ThreadView.tsx`'s `EntryRow`) opening **Edit** or **Copy thread from here**, plus its own always-there `StickyNote`
icon that expands a small inline note editor (add/edit/delete) — no separate "Annotate" menu entry any more. The
composer has its own ⋯ beside Send that copies at the last message and appends the typed draft as the copy's next
note, in one call.
Copy (`POST /api/threads/:id/copy` + `localApi.copyThread`, one transaction each, idempotent on a client-minted
`newThreadId`) and Annotations (own SQLite table + IndexedDB stores, own dirty flag threaded through every sync
path — `countUnsynced`, `unsyncedBatch`, `commitPush`, `mergeRemoteThread`, `applyRemoteDelete`, the handoff verify
step, trash, backup import/export, both image orphan-GC scans — the thread hash only grows a segment once a thread
actually has one) are both done. `description`/`tags`/`embedding` stay null on a copy; no `copiedFrom`/`forkedFrom`
provenance (decided 2026-09-22, see below).

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

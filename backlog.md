# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices are in `README.md`; ideas that are
not committed to yet are in `inspiration.md`. What is left is v1 work, v2, or can't be settled without a real phone.

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
provenance (decided 2026-09-22, see below). `+` / `n` makes `Thread: NNN`, opens it, retries auto-naming it from
every note (not just the first) until it sticks, and reuses an empty untouched placeholder instead of piling up
another — done, bar a `/capture` deep link / PWA shortcut into a focused composer (real-phone list, below). Open
Todos (`frontend/src/features/todos`, read-only by design — decided 2026-09-22, see below) is done too:
`lib/todos.ts`'s `parseOpenTodos`/`collectOpenTodos` are a pure scan for `- [ ] ` lines over every message, fed by
`lib/local.ts`'s `exportSnapshot` — the device copy, which `lib/replica.ts`'s `pullMain` keeps warm with every
thread's messages live or local alike, so no new backend endpoint was needed. Reachable from the sidebar footer,
beside the settings gear.

v1 is closed out; what's left of it is real-phone-only — see "Blocked on a real phone" below.

**Decided 2026-09-22:** no `copiedFrom` / `forkedFrom` provenance for Copy. Simpler now; a copy's origin cannot be
recovered later if this turns out to matter (e.g. for collapsing near-duplicates once search/trend-detection
exist).

**Decided 2026-09-22:** Open Todos ships read-only, no tick-in-place. Ticking a box is a content edit — it would
need the same edit-with-history machinery as any other message edit (`editMessage`), and two devices ticking
different boxes offline would silently lose one under "newest text wins." Real complexity for a feature whose
whole value here is "see everything I meant to do"; tick-in-place can come later if it's actually missed.

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

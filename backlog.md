# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices
are in `README.md`. What is left is v1 gaps against the goals, v2, or can't be settled without a real phone.

## Next — v1 gaps against the goals

Goals: capture an idea in seconds without opening anything else, replace Obsidian and chat apps,
detect recurring themes ("similar to x"), stay 100% local.

- **Capture without a title, the rest.** `+` / `n` now makes `Thread: NNN` and opens it, and yatefca names it from
  the first note. Still missing: opening the app (or a `/capture` deep link / PWA shortcut) landing in a focused
  composer, and an Inbox. Pressing `+` and walking away leaves an empty `Thread: NNN` behind; decide whether to
  create on the first note instead. yatefca gives nothing for a very short note; `generateMetadata` could name those.
- **Related threads failed for a fixable reason.** One vector per thread, built in `metadata.ts` from
  `title + description + tags + the first 2000 chars` of the transcript: a thread is represented by its
  beginning plus a 0.8B-model summary, so a thread that grows drifts away from its vector. Try per-note (or
  chunk) embeddings, drop the LLM description/tags from the embedding input, thread score = best/mean note
  match; judge on real data before wiring the endpoint into the UI (AGENTS.md says "do not wire it" until then).
  The same embeddings feed "similar to x" while writing and, later, a periodic theme digest.
- **Search and todos.** Search is a literal `LIKE` (`db.ts`): no ranking, no meaning. Want SQLite FTS5 first,
  then a semantic fallback with the existing `embed()`. Nothing gathers `- [ ]` across threads; an "Open todos"
  view needs a query over messages, plus a decision on ticking a box (it is an edit, so it lands in `edits`).

## v2 features (deferred by design)

- **Related threads as a graph** (entity extraction + community detection). The plain "similar threads"
  feature is tracked under Next.
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

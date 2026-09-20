# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices
are in `README.md`.

## v2 features (deferred by design)

- **Related threads.** `GET /api/threads/:id/related` (embedding cosine) exists but
  is not in the UI — similarity wasn't meaningful at this scale. v2 revisits this as
  a real graph feature (entity extraction + community detection, per handover §1).

## Streaming voice — shipped, residual device testing

Implemented: VAD-segmented streaming (`@ricky0123/vad-web` Silero v5 → per-utterance
whisper-tiny decode with streamed tokens → append-only IndexedDB segment log). One
hook: `frontend/src/hooks/useVoiceCapture.ts`; storage: `frontend/src/lib/voice/
recordings.ts`. Design + research: `.research/streaming-voice-plan.md`.

- **iOS background limit (won't fix in the PWA).** WebKit suspends the mic +
  AudioContext seconds after screen-lock / backgrounding. The hook holds a Screen
  Wake Lock and flushes on `visibilitychange`, and the UI says "keep this screen on".
  True screen-off recording would need a Capacitor/native shell.
- **Needs HTTPS on the phone.** `getUserMedia` is blocked on `http://<lan-ip>` in iOS
  WebKit — serve the frontend over TLS (or a tunnel / `localhost`) for on-device tests.
- **Whisper model size.** Still `Xenova/whisper-tiny.en` (`DEFAULT_MODEL`, one constant).
  Test tiny vs base on a real phone at hour-scale.
- **Tuning constants** in the hook: `redemptionMs` (900), `INTERIM_MS` (2500),
  `MAX_UTTER_S` (25). Adjust on-device if segments chop mid-sentence or the phone
  runs hot.
- **First-run model download** (~40MB whisper weights + onnxruntime wasm) is
  runtime-cached — offline voice-to-text works only after one online use. VAD assets
  (~2MB) are precached so capture works offline immediately after install.
- Run the manual checklist in `.research/streaming-voice-plan.md` §9.

## Local mode — investigate after real-world testing

Rule of thumb today: the device is treated as ahead; conflicts resolve to "content wins" and are
reported afterwards, never asked. Revisit once this has run against real use:

- **Auto-sync mode.** Detaching is automatic; coming back needs a click. An opt-in setting could
  sync + go live by itself when main returns (needs a guard against flapping — the two-probe
  hysteresis in `status.ts` is the starting point).
- **Confirm step for conflicts.** Only worth it if "content wins" ever surprises. The dialog
  already reports what was kept/removed; a "review before sync" list would build on that.
- **Metadata on local threads.** description/tags are excluded from the hash (they're generated
  asynchronously after each append), so a metadata-only change on main reaches the device copy via
  the list refresh (`updateMeta`), not the hash compare.
- **`seq` ties** when two devices append to the same thread while apart: order falls back to
  insertion; no data is lost. A `createdAt` tiebreak in `getThreadMessages` would tidy it.
- **Seed note dedupe.** If a live create-with-seed reaches main but its reply is lost, the
  device's retry creates its own seed note (different id) → one duplicate line at sync.
- **Static hosting (GitHub Pages).** `VITE_LOCAL=1` works without a backend, but Pages serves
  under `/<repo>/`: `/vad/…`, `/icon.svg` and the manifest `start_url`/`scope` need Vite `base`.
- **Ask on the phone.** Capture-only while local. Options: queue asks until main is reachable, or
  paste an API key (billed, key lives on the phone).
- **No in-app restore** of `trash` / safety copies / main's backups; they're plain JSON or
  SQLite files (re-import via Import; copy a backup over `threadz.sqlite`).

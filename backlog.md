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

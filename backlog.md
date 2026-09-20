# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices
are in `README.md`.

## v2 features (deferred by design)

- **Related threads.** `GET /api/threads/:id/related` (embedding cosine) exists but
  is not in the UI — similarity wasn't meaningful at this scale. v2 revisits this as
  a real graph feature (entity extraction + community detection).

## Images in notes — shipped, what remains

Shipped: attach (button/paste/drop) → JPEG ≤1600px → device `threadz-images` DB, outside every backup
(details and the "no image backups" decision in `README.md`); lazy grey-box rendering; `PUT`/`GET
/api/images/:hash` on main; photos pushed before `/api/sync` and best-effort on every live pull. Verified
headless in Chrome (desktop + 390px, live + local, reload, sync back). **Not yet tried on a real phone**
(iOS HEIC picker, camera capture, canvas memory on old iPhones, `crypto.subtle` needs HTTPS there).

Left:

- **Export backup does not contain images** (JSON only), so a file restored on a fresh device shows grey boxes
  until it syncs with a main that has them. Zip export, or say so in the UI.
- **A photo main rejects blocks going live.** `syncNow` throws if a `PUT` fails, so a permanent 4xx (can't happen
  with our own ≤1600px JPEGs, but it's a wedge if it ever does) would stop the sync. Skip-and-report if it shows up.
- **Local mode is on-demand for images.** Offline, a photo that was never viewed while live is a grey box; going
  live never back-fills. Decide a replication policy (cache all / recent N) once real use shows the volume.
- **Thumbnail tier** (~600px) if decoded-bitmap memory kills the iOS tab with many images in one thread.
- **Orphan GC** of files/blobs no note references (main and device). Nothing evicts cached-from-main images either.
- **Large uploads / body caps.** One ~300KB `PUT` is fine; revisit (streaming, keep originals) if images get bigger.
  Main's ceiling is `MAX_IMAGE_BYTES` (8MB) in `backend/images.ts`.
- **Editing.** No image button in the per-note editor (Composer only);
  an image is removed with Backspace on it. No alt text / captions.
- **Image-only notes** get metadata from the title alone (image markdown is stripped from the transcript); no
  vision captioning.
- `navigator.storage.persist()` on the installed iOS PWA: verify it holds, since photos on a not-yet-synced
  device exist nowhere else.

## Streaming voice — shipped, residual device testing

Dictation, not "recording": tap the mic, speak, text lands **at the caret** in the composer
(type "hello", speak "world", type "!" all compose). VAD (`@ricky0123/vad-web`, Silero v5,
AudioWorklet) cuts utterances → one whisper decode per utterance in a worker → text is
inserted and also appended to an IndexedDB segment log (crash recovery banner).

Layout: engine `frontend/src/lib/voice/engine.ts` (plain module + external store, no React
in the audio path), hook `features/composer/useVoiceCapture.ts` (`useSyncExternalStore`), models/languages
`lib/voice/models.ts` (one row = one new model/language), caret/spacing rules `lib/voice/text.ts`
(tested), segment log `lib/voice/recordings.ts`. UI: `Composer` + `MarkdownEditor.insertAtCaret` (dictation inserts at the ProseMirror caret; no caret yet → end),
`VoiceMeter` (5-bar level meter, direct DOM writes), `VoiceSettings` (model + language).

Verified headless in Chrome with a fake mic (real VAD + real whisper): typed+dictated
compose, Stop mid-utterance still flushes that speech, mid-text caret insert, model
switch/download, blocked-download error path. **Still needs a real phone:**

- **iOS background limit (won't fix in the PWA).** WebKit suspends the mic + AudioContext
  seconds after screen-lock / backgrounding. We hold a Screen Wake Lock, release the mic when
  the page is hidden and re-acquire on return. True screen-off needs a Capacitor/native shell.
- **Needs HTTPS on the phone.** `getUserMedia` is blocked on `http://<lan-ip>` in iOS WebKit —
  serve over TLS (or tunnel / `localhost`). The UI says so when it's blocked.
- **Model choice.** Default is `whisper-tiny.en`. Test tiny vs base (and `small` on desktop) at
  hour-scale on the phone; the gear next to *Add* switches models (selecting downloads it).
- **Tuning constants** in `engine.ts`: `REDEMPTION_MS` (800, silence that ends an utterance),
  `MAX_UTTER_S` (25), `IDLE_UNLOAD_MS` (3 min, worker terminated to free RAM). Adjust if
  segments chop mid-sentence or the phone runs warm.
- **First-run download** (~40MB for tiny + onnxruntime wasm) is runtime-cached; the model only
  downloads when you first tap the mic or pick it in the panel (not on app open). Offline
  dictation works only after one online use. VAD assets (~2MB) are precached.
- **Multilingual quality.** `tiny` is weak outside English; try `base`/`small` for Dutch etc.

Deferred:
- A real central settings page (voice panel is a stopgap inline in the composer).
- WebGPU decode where available (much cheaper per utterance; not on iOS).
- Selecting a model while another is still downloading waits for the first to finish.
- Downloaded-badge is a localStorage hint, not a Cache Storage check.

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
  under `/<repo>/`: `/vad/…`, the icons/`favicon.ico` and the manifest `start_url`/`scope` need Vite `base`.
- **Ask on the phone.** Capture-only while local. Options: queue asks until main is reachable, or
  paste an API key (billed, key lives on the phone).
- **No in-app restore** of `trash` / safety copies / main's backups; they're plain JSON or
  SQLite files (re-import via Import; copy a backup over `threadz.sqlite`).

## Known issues — found in the code-quality audit, not fixed

Reported by a read-only audit; none reproduced in a running app. Each is small; fix when touching the file.

- **Push race (`local.ts` `commitPush`).** A row is marked clean without comparing it to what was sent, so a
  rename made during the push round-trip can be overwritten by main's title. Message edits are re-sent by the verify step.
- **Status probe (`status.ts`).** The first probe sets `reachable` directly, so a single failed ping while live with a
  warm copy auto-detaches; the "two agreeing probes" comment is not what the code does.
- **`detach()` (`mode.ts`)** sets `auto` even when already local, so a later `goLive` can show a false "main went away".
- **Voice worker (`voice/engine.ts`, `whisper-worker.ts`).** After `onerror` the dead worker is kept, so the next load
  hangs; a quick Stop then Start can release the new session's mic; the worker's message chain has no `.catch`.
- **`findUnfinished` (`recordings.ts`)** only inspects the newest row, so an empty newest one hides an older recoverable one.
- **`replica.ts`.** `hash ?? ""` makes a thread refetch on every pull; a throw in `drainOutbox` aborts `syncNow`.
- **`mergeSnapshot` (`local.ts`)** can create duplicate `seq` values and drops trashed messages the file lacks.
- **Import (`handoff.ts`)** checks that keys exist, not their types; a bad file is stored as pending and can crash search.
  A stored voice language that is not in `LANGUAGES` makes every utterance fail.
- **`api.ts`** sends `content-type: application/json` on GETs (a CORS preflight each time); a JSON `null` error body throws a TypeError.
- **`imageSync.ts`** caches bytes from main without checking their sha256 against the hash.
- **Plain `http://<lan-ip>`** has no `crypto.subtle` / `randomUUID`, which breaks more than voice (see the HTTPS note in the README).
- **`voice/text.ts`** strips real speech that sits in parentheses or asterisks.
- **`useThread`** `load` has no staleness guard (out-of-order results can overwrite newer data).
- **`ThreadView` header** shows "…" forever if the open thread is deleted elsewhere (a "not found" state would have to
  tell "still loading the mirror" from "gone"). `useDraft` reads its storage key once, so it is only safe because
  `App` keys `ThreadView` by thread id.

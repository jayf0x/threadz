# Threadz backlog

Open items only. Resolved work lives in the git history; deliberate scope choices and how things work are in
`README.md` / `AGENTS.md`; ideas that are not committed to yet are in `inspiration.md`.

**v1 (incl. V1.5–V1.7) is closed.** What is left is v2, or can only be settled on a real iPhone.

## Open — v1

- **Design call: accent contrast as text.** In the light modes of Gruvbox and Solarized, `--primary` on
  `--background` measures ~2.9–3.0:1 (white on primary ~3.1–3.2:1; Nord light 3.8:1) — below 4.5:1 for small
  accent-coloured text and button labels. Meeting it means darkening the brand accent (orange → brown-ish), so it's
  a choice, not a bug fix; every other measured pair passes.
- **Todo gutter checkboxes are ~35px tall to hit** (target 44px): they sit at `left:-22px` in the message gutter, so
  widening sideways pushes the hit box off the screen edge. Needs a layout decision (a wider gutter, or moving the box
  inside the text column).

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

Everything is verified headless in Chromium (desktop + iPhone-sized viewport, fake mic, production build offline);
none of it has run on iOS WebKit or a device.

- **Keyboard and viewport (V1.7):** `lib/viewport.ts` sizes the shell from `visualViewport`; simulated by shrinking
  the viewport, never with real iOS panning. Confirm: composer pins above the keyboard while focused and scrolls
  with the messages when not, top and bottom of a long thread stay reachable while the keyboard animates, no page
  rubber-band on the tab panels, bottom-nav safe-area padding, `data-keyboard` toggling.
- **Dictation on iOS:** the tap raises the keyboard and focuses the editor; the **second** start crashed the iOS PWA
  once (likely WebKit's memory ceiling with the whisper WASM heap + a fresh VAD session). If it recurs: keep one
  `MicVAD` and `pause()/start()` instead of `new`/`destroy` per session, or default to `whisper-tiny`.
- **Edit in place, note sheet (design-pass):** `enterEdit()` raising the keyboard from the Edit tap on the mounted
  editor (fallback if not: focus a hidden input in the gesture, then move focus), the note editor autofocusing inside
  the sheet (autofocus is on mount, not from a tap), sheet + menu placement with the keyboard up, iOS focus-scroll
  when a row near the bottom enters edit, the scroll-follow fix under momentum scrolling.
- **Popovers and the message menu on iOS:** positioning with the keyboard open, tap targets, dismissal, and that
  "Add note" (actions-row button → sheet/popover with an autofocused editor) keeps focus, and that Edit's
  `enterEdit()` inside the tap raises the keyboard on an already-mounted editor.
- **Deep-link straight into capture.** `?capture=1` / the PWA shortcut opens a focused composer everywhere it could be
  tested; WebKit may not raise the keyboard from a programmatic focus outside a direct tap.
- **Images:** iOS HEIC picker, camera capture, canvas memory on old iPhones; a ~600px thumbnail tier if
  decoded-bitmap memory kills the iOS tab with many images in one thread; `navigator.storage.persist()` on
  the installed PWA (photos on a not-yet-synced device exist nowhere else); `crypto.subtle` on plain `http://`.
- **Voice, iOS background limit (won't fix in the PWA).** WebKit suspends the mic + AudioContext seconds
  after screen-lock. True screen-off needs a Capacitor/native shell.
- **Voice model choice and quality.** Default `whisper-tiny.en`; test tiny vs base (and `small` on desktop)
  at hour-scale on the phone, and `base`/`small` for Dutch etc. (`tiny` is weak outside English). Tuning constants in
  `engine.ts`: `REDEMPTION_MS` (800), `MAX_UTTER_S` (25), `IDLE_UNLOAD_MS` (3 min).
- **Local-mode timing:** whether the 2-probe detach (15s interval + `online`/`focus`) feels right on a flaky
  Wi-Fi handoff.

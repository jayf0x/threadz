# Threadz backlog

Open items only. Resolved items live in the git history; deliberate scope choices are in `README.md`; ideas that are
not committed to yet are in `inspiration.md`. What is left is v1 work, v2, or can't be settled without a real phone.

## Next — v1

Goals: capture an idea in seconds without opening anything else, replace Obsidian and chat apps, stay 100% local.
Anything AI-generated (descriptions, tags, themes, "similar to x") is v2 for now.

AI metadata is out of v1: gated behind `THREADZ_METADATA` (off by default — see `.env.example`), `ThreadRow`/search
show/match title and note text only, `description`/`tags`/`embedding` stay nullable fields nothing new depends on.

`Menu` (Radix `@radix-ui/react-dropdown-menu`, decided 2026-09-23, see below) and `MessageInput` are built;
`Composer` wraps `MessageInput`. Each of your own notes has a ⋯ (`ThreadView.tsx`'s `EntryRow`) opening **Edit**
or **Copy thread from here**, plus its own always-there `StickyNote` icon that opens a Radix `Popover` (add/edit/
delete) instead of expanding inline — a note used to push the rest of the thread down and out of view while it
was open, which lost your place scrolling past it; a popover floats over the content instead, so reading down a
long thread never gets interrupted by one. The composer has its own ⋯ beside Send that copies at the last message
and appends the typed draft as the copy's next note, in one call.
Copy (`POST /api/threads/:id/copy` + `localApi.copyThread`, one transaction each, idempotent on a client-minted
`newThreadId`) and Annotations (own SQLite table + IndexedDB stores, own dirty flag threaded through every sync
path — `countUnsynced`, `unsyncedBatch`, `commitPush`, `mergeRemoteThread`, `applyRemoteDelete`, the handoff verify
step, trash, backup import/export, both image orphan-GC scans — the thread hash only grows a segment once a thread
actually has one) are both done. `description`/`tags`/`embedding` stay null on a copy; no `copiedFrom`/`forkedFrom`
provenance (decided 2026-09-22, see below). `+` / `n` makes `Thread: NNN`, opens it, retries auto-naming it from
every note (not just the first) until it sticks, and reuses an empty untouched placeholder instead of piling up
another. The same create-or-reuse logic (`features/threads/createOrReuseThread.ts`) now also backs a `/capture`
deep link: `?capture=1` (the installed PWA's long-press "New note" shortcut, `vite.config.ts`) opens straight into
a fresh thread with the composer focused (`MarkdownEditor`/`MessageInput`/`Composer` all gained a mount-time
`autofocus`) — done on every platform except the final "does iOS actually raise the keyboard" check, which needs
a real iPhone (see "Blocked on a real phone"). Open
Todos (`frontend/src/features/todos`, read-only by design — decided 2026-09-22, see below) is done too:
`lib/todos.ts`'s `parseOpenTodos`/`collectOpenTodos` are a pure scan for `- [ ] ` lines over every message, fed by
`lib/local.ts`'s `exportSnapshot` — the device copy, which `lib/replica.ts`'s `pullMain` keeps warm with every
thread's messages live or local alike, so no new backend endpoint was needed. Reachable from the sidebar footer,
beside the settings gear.

v1 is closed out; what's left of it is real-phone-only — see "Blocked on a real phone" below.

**Decided 2026-09-23 (round two of the same feedback pass):** the note popover, the mobile header, the
`html`/`body` overflow lock, the edit box's measured min-height and the message-list virtualizer (all above, and
`AGENTS.md`) landed **without a browser or device available this session** — no `browser_tools`, no simulator
with a full Xcode install. Verified: `bun run check` and `bun run --cwd frontend build`, and a careful read of
each change against the framework's own documented behavior (Radix's collision handling, `@tanstack/react-virtual`'s
dynamic-measurement recipe). Not verified: how any of it actually looks or feels, on a phone or otherwise. Treat
the "everything is verified headless in Chrome" line below as true through the 390px-viewport work that predates
this round, not this round itself, until someone actually opens it.

**Decided 2026-09-23:** hand-rolled `components/ui/popover.tsx` is gone, replaced by
`@radix-ui/react-dropdown-menu` inside `components/ui/menu.tsx` (same `{trigger, items, align}` call shape, zero
changes at either call site — `ThreadView.tsx`'s message-actions menu, `Composer.tsx`'s ⋯ menu). The custom
positioning math had already needed one bug fix (didn't flip when it wouldn't fit below) and then broke
completely in the next change (an `AnimatePresence`+`createPortal` ordering mistake made it not open at all) —
two bugs in one hand-rolled component in one week is the signal to stop hand-rolling it. Also dropped: the
phone-width "renders as a bottom sheet" branch (Radix's own collision handling keeps the menu on-screen at any
width without it) and the open/close animation (Radix ships instant by default; animating a Radix primitive's
mount needs `forceMount` + `AnimatePresence`, a separate integration not worth taking on for a small action
list — see AGENTS.md). If a bottom-sheet-style menu is wanted later, `vaul` (Radix-based, the shadcn "Drawer")
is the equivalent move, not a hand-rolled one. Nothing else in the app is hand-rolled the same way: the
`ConnectionDialog`'s `<dialog>` and `components/ui/select.tsx`'s `<select>` are native elements already, not
custom logic, so they weren't touched.

**Decided 2026-09-22:** no `copiedFrom` / `forkedFrom` provenance for Copy. Simpler now; a copy's origin cannot be
recovered later if this turns out to matter (e.g. for collapsing near-duplicates once search/trend-detection
exist).

**Superseded 2026-09-23** (was: "Decided 2026-09-22," read-only, no tick-in-place). The edit-with-history
machinery this was waiting on already exists (`editMessage`, used by every other note edit); "two devices tick
different boxes offline" is the same newest-text-wins collision any concurrent edit to one message already has,
not a new risk specific to todos. Missed sooner than expected — see "Next — Todo commands" below, which replaces
this feature with a small general one (`@/` commands, `inspiration.md`) instead of just unlocking the checkbox.

## Next — Todo commands (`@/todo`, see `inspiration.md` "Commands: a content primitive")

Turns the read-only Todos view into the real thing: a todo declared inline in any thread with `@/todo <text>`
(kept alongside the existing `- [ ] ` scan, not replacing it), tickable from the sidebar, jumps back to its
message. Text stays the single source of truth throughout — see `inspiration.md` for why. Land in this order,
each its own commit:

1. **`lib/todos.ts` parser.** Recognize `@/todo <rest of line>` (open) and `~~@/todo <rest of line>~~` (closed,
   real markdown strikethrough) as well as the existing `- [ ] `/`- [x]`. One function, not a command-plugin
   framework — there's only one command. Return `done` on every entry instead of only open ones; update
   `collectOpenTodos`'s callers for the new shape. Pure function, needs a `bun test` case per syntax variant.
2. **Tick-in-place.** `TodosPanel`'s checkbox calls `editMessage(messageId, newContent)` with the line's `~~`
   wrapped/unwrapped, the same call `ThreadView`'s edit mode already makes. Add a closed-todo filter, default
   hidden, and a count of each. Update README's "Open todos" section — it currently says read-only.
3. **Done.** Jump to message. `?thread=<id>&msg=<id>` (`App.tsx`, same pattern as `?capture=1`), parsed once on
   mount and shared with the sidebar's click through one `openThreadAt(threadId, messageId)` — the click also
   `history.pushState`s the pair so it's shareable/back-button-able. `ThreadView` takes a `scrollToMessageId`
   prop and calls the virtualizer's `scrollToIndex` once the message's index is known (re-checked as `messages`
   loads, so it can't scroll to a stale index), then flashes it via `.message-highlight` (`styles.css`) — plain
   CSS, not Motion.
4. **Done, decoration-only (not the full remark-node route originally sketched here).** Checked first: GFM
   strikethrough already rendered (`~~x~~` → `<del>`) with zero changes — `CrepeBuilder` bundles the full
   `@milkdown/kit/preset/gfm` preset unconditionally (`@milkdown/crepe`'s own `builder.js`), confirmed by booting
   a headless editor and inspecting the output HTML rather than assuming. `@/todo` itself still isn't a markdown
   construct, so rather than adding a remark plugin + ProseMirror node schema + serializer (real work, and this
   step was explicitly cuttable), went with option (b) from the start: a ProseMirror decoration plugin
   (`features/editor/todoDecoration.ts`) that finds top-level paragraphs whose rendered text starts with
   `@/todo`, prepends a clickable checkbox widget (same `Square`/`SquareCheck` visual language as `TodosPanel`),
   and reads `done` off the `strike_through` mark already on the text. No new node type, no parser/serializer
   changes. A click maps the paragraph's doc-order position back to the matching entry in `parseTodos(value)`
   and calls `toggleTodoLine`, same as the sidebar. Wired only into the message's read-only view
   (`ThreadView.tsx`'s `EntryRow`, via a new `onTodoToggle` prop on `MarkdownEditor`) — edit mode renders the
   raw markdown textarea (`raw` prop), not Crepe, so there's nothing to decorate there; toggling from inside a
   message is read-mode only, same as the sidebar already was. Verified end-to-end (checkbox renders,
   click rewrites only that line, other content untouched) with a headless render, not just typechecking.

No backend table, no new IndexedDB store, no new sync/merge rule — deliberate, see `inspiration.md`.

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
- **Deep-link straight into capture — code done, verification isn't.** `?capture=1` / the PWA shortcut (above)
  opens a focused composer on every platform this could be tested on (desktop Chrome, 390px). iOS is the one
  unknown: WebKit does not raise the keyboard from a programmatic focus outside a direct tap, so landing "focused"
  may still show no keyboard until one manual tap — can't be confirmed without a real iPhone.
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

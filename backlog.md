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

## Next — Todo feedback round (2026-09-23, real use of the above)

First real feedback on the four items above. Two were bugs, not opinions — fixed directly, no agent needed:

- **Fixed: cross-view state lag, including the "closed todo needs two clicks" symptom.** Root cause was in
  `lib/sync.ts`, not React state management (no signals/Jotai needed) — `pullThread`/`pullThreads` called
  `emitChange()` *before* `keepReplicaWarm()` (the `pullMain()` call that actually updates `threadz-local`,
  which `useTodos` reads via `exportSnapshot`) resolved, and nothing emitted again once it did. Any listener
  reading the fast mirror (`ThreadView`'s `useThread`, via `lib/db.ts`) redrew correctly, since that store *is*
  current by the first `emitChange()`; `useTodos` redrew from stale data and stayed stale until some unrelated
  change happened to fire `emitChange()` again. A second click's own `pullThread` cycle would, by the time its
  *own* early `emitChange()` fired, often find the *first* click's `keepReplicaWarm()` had finished in the
  background — which is exactly the "needs a second click" symptom. Fix: emit again after `keepReplicaWarm()`
  resolves too (`lib/sync.ts`).
- **Fixed: Todos panel closing itself after you open a thread from it.** `ThreadList.tsx`'s todo-row click
  handler called `setPanel("index")` right after opening the thread — so clicking a second todo meant reopening
  the Todos panel every time. Removed; the panel now only changes on an explicit switcher click or the mobile
  back arrow.
- **Fixed: footer icon buttons → header switcher.** The Index/Todos/Settings toggle was two unlabelled 24px
  buttons buried in the footer next to sync/theme controls. Moved to a `SidebarSwitcher` in a new header bar,
  same segmented-`fieldset`-of-radios pattern as `ThemeToggle` (so the sidebar's two three-way toggles now read
  as one visual family) — labelled, not icon-only. `ThreadList.tsx`.

Still open, needs real implementation work (see the sub-sections below, each its own agent hand-off):

1. **Done: checkbox in the message view reads as UI bolted onto markdown, not markdown.** Went with the
   feedback's own first option: the clickable checkbox widget (`checkboxWidget()`, a `<button>` decoration
   prepended to the paragraph) is gone from `todoDecoration.ts` — the plugin no longer takes `getValue`/`onToggle`
   at all, since there's nothing left to click. What's left: a `Decoration.inline` around the literal `@/todo`
   token (`.threadz-todo-token` — accent color, semibold) plus the existing `Decoration.node` line wrap
   (`.threadz-todo-line` — accent background wash, `var(--primary)` left rule), both in
   `markdown-editor.css`, both semantic tokens per AGENTS.md. Closed (`~~@/todo …~~`) still gets real GFM
   strikethrough for free; the highlight itself fades (`.threadz-todo-line--done`: background back to
   transparent, rule to `var(--border)`, token color inherits the muted strikethrough color) instead of
   fighting it. `onTodoToggle` is gone from `MarkdownEditor`/`CrepeEditor` and its one call site
   (`ThreadView.tsx`'s `EntryRow`, the read-only `MarkdownEditor` for `m.content`); `commandTodoLines` (the
   click→line-index mapping) is deleted with it, nothing else used it. State edits are sidebar-or-raw-edit-mode
   only again, same as the legacy `- [ ] ` syntax already was before step 4 above (Crepe's native GFM task-list
   checkbox is untouched — out of scope, the feedback was specifically about the widget this feature added). The
   gutter idea (VS Code-style, a reusable action rail down the left of a message — could also host the note
   icon) is real but bigger scope; parked in `inspiration.md`, not built now.
2. **Done: grouped todo lists + convert-a-message action ("Todo model v2").** `lib/todos.ts`'s `Todo` is now a
   discriminated union (`kind: "line" | "group" | "message"`) instead of one flat shape; `TodosPanel.tsx` renders
   each kind differently (a plain row, a titled card of items, or a truncated-content row) instead of N flat rows.
   - `@/todos <title>` (own trigger, `parseTodoGroups`) followed by a contiguous run of list-item lines — `- `,
     `* `, `+ `, with or without `[ ]`/`[x]` — stops at the first blank line or the first non-list line. A plain
     `- item` with no checkbox parses as open; toggling it now *adds* the checkbox (`- [x] item`), it doesn't
     require one up front. Checked what Crepe/`@milkdown/preset-commonmark` actually round-trips first: its
     markdown serializer always emits `-` regardless of what bullet character was typed (remark-stringify's
     default), so `*`/`+` support is for raw/pasted/imported content, not anything the app itself produces.
     `parseTodos` (the flat single-line scan) now skips whatever a group already consumed, so a `- [ ]` list item
     under a `@/todos` header isn't also counted as its own flat todo. `todoDecoration.ts` untouched — it only
     ever cared about single `@/todo` lines, and a group's items already render as Crepe's native GFM task list.
   - A message-level "Add to Todos" / "Remove from Todos" action in the existing ⋯ menu (`ThreadView.tsx`'s
     `EntryRow`) flags the *whole message* as a todo without inserting any `@/todo` text — non-textual state in
     `meta.todo: { done: boolean }` (`frontend/src/lib/types.ts`'s new `MessageMeta`, `backend/schemas.ts`'s
     `MessageMeta`/`EditMessageMeta`). Its own small route, `PATCH /api/threads/:id/messages/:mid/meta`
     (`editMessageMeta` in `backend/db.ts`) — `EditMessage` keeps `content` required, so meta needed a route of
     its own rather than an awkward optional-content edit; a patch always *merges* into `meta`, a key set to
     `null` deletes it (used by "Remove"), so an unrelated future `meta` field is never clobbered. `lib/api.ts`'s
     `toggleMessageTodo`/`removeMessageTodo` (both `remoteApi` and `localApi`, `via()`-wrapped in `api`); the
     sidebar's checkbox on this kind of entry calls these directly, never `editMessage`.
   - **The sync-path gap flagged going in was real and got fixed, not just checked.** `meta` was already in
     `SyncPayload` and already sent on every push, but `applySync` never actually applied an incoming `meta` to a
     message that already existed (`appendMessage` no-ops once the id is taken, and nothing else touched `meta`
     after that) — a device's meta change would reach main's `/api/sync` and be silently dropped. Fixed by giving
     `meta` its own last-write-wins clock, `meta_edited_at` (`addColumn`, mirrors `edited_at`'s shape but kept
     separate — a meta-only change must not read as a content edit, no history entry, no "edited" label), applied
     in `applySync` the same way `editedAt` already was. `threadHash` was the second gap: it only ever hashed
     `edited_at`, so a meta-only change on main would never move the hash a device compares against, and a pull
     would never notice — fixed by hashing `max(edited_at, meta_edited_at)` per message (byte-for-byte the old
     formula when neither has ever moved, so every untouched thread's hash is unchanged). On the device side,
     `local.ts`'s `mergeRemoteThread`/`commitPush` compared only `content`/`editedAt`/`edits` when deciding what
     counts as "the same" — extended (not replaced) to also compare `meta`/`metaEditedAt`, with a small
     `mergeMeta` last-write-wins helper alongside the existing `mergeMessage` content merge, reusing the same
     shape rather than inventing a new rule.
3. **Done: per-thread reverse order.** An `ArrowDownUp` icon button in `ThreadView`'s header (next to the
   title, `aria-pressed` + a "Newest first"/"Oldest first" title) flips a thread's virtualized list between
   the default (oldest at top, newest at bottom) and reversed. Device-local, per-thread, not synced — same
   `localStorage` + typed getter/setter + `useSyncExternalStore` shape as `lib/settings.ts`, just keyed by
   thread id (`lib/threadOrder.ts`, one `threadz.reverseOrder` key holding `Record<threadId, true>`; a thread
   never flipped has no entry rather than storing `false`). Went with the single-derived-array approach flagged
   as less fragile: `orderMessages(messages, reversed)` (the one pure, tested piece — `threadOrder.test.ts`) is
   the only place the flip happens, and every rendering-order consumer in `ThreadView` — the virtualizer's
   `count`/`getItemKey`, the render loop's `orderedMessages[row.index]` lookup, and the jump-to-message effect's
   `findIndex` — reads that same `orderedMessages`, never `messages` directly. `messages` itself stays
   chronological and untouched, since `Composer`'s `messages.at(-1)` ("copy thread from here"'s target) and the
   sidebar/`useThread` logic both assume oldest-last; only rendering order is derived. The "follow newest"
   autoscroll (`ThreadView`'s effect near `scratch`) now scrolls to index 0 instead of the list's end when
   reversed, since newest sits at the top there. Jump-to-message needed no special-casing for either order —
   virtualizer index space, key, and lookup all come from `orderedMessages`, so `scrollToIndex` always lands on
   the right row; verified by tracing it through (both `count`/`getItemKey` and the render loop's `m` come from
   the identical array the `findIndex` searches) rather than assuming.

## Next — Todo feedback round 2 (2026-09-23, further use of the above)

Land in this order — item 1 first and solo (it touches the URL/selection plumbing every other message-row
change brushes against), then 2 and 3 in parallel (disjoint files once 1 is in):

1. **URL always reflects what's open, message selection becomes a real thing, not a one-shot flash.** Today
   only a todo-row click pushes `?thread=&msg=` (`ThreadList.tsx`'s inline `history.pushState`); picking a
   thread from the Index does nothing to the URL at all — the one manual push call is the only reason todos
   worked and everything else didn't. Fix at the root: stop pushing the URL from scattered click handlers and
   sync it from state instead, in one place (`App.tsx`, alongside the existing mount-time `?thread=&msg=`
   parse it already does for `?capture=1`-style deep links). `selected` (thread) already lives there; give
   message selection the same status — a real `selectedMessageId`, not the current fire-and-forget
   `scrollToMessageId` + `highlightId` that fades after 1.6s (`ThreadView.tsx`'s jump-to-message effect, landed
   this session). Settled shape: clicking a message row selects it (persists, reflected in `?msg=`), clicking
   it again or clicking another message changes/clears selection, and it's still scrolled-into-view + given an
   arrival pulse the moment selection changes via navigation (a todo click, a pasted URL) but not from a plain
   in-thread click (already visible, no scroll needed). Push vs. replace: pushState on a thread change (so back
   steps between threads, matching today's todo-click precedent), replaceState on a message selection within
   the same thread (toggling which line is selected shouldn't spam history). Click-target discipline: the
   select-toggle must not fire from the ⋯ menu, the note trigger, a todo checkbox, or anything inside edit mode
   — verify empirically (headless render + simulated clicks), don't assume Milkdown's read-only view doesn't
   already swallow some of these.
2. **The full gutter** (parked in `inspiration.md`, promoted now). A per-message left rail, not inline text
   decoration — this is the fix for last round's "checkbox floats next to the text" complaint that goes further
   than CSS-only: keep the checkbox, just stop rendering it *inside the text flow*. Mechanism: `Decoration.widget`
   (same primitive `todoDecoration.ts` already used before this session's CSS-only pass) positioned with
   `position: absolute` relative to its own paragraph (already `position: relative` via the existing
   `Decoration.node` wrap) and a negative `left`, with the paragraph given matching `padding-left` — a true rail,
   no DOM measurement needed, no gutter-as-separate-column layout. Hosts, per line: a todo checkbox for `@/todo`
   and every `@/todos` item line (click toggles via the same `toggleTodoLine` path as the sidebar). Also hosts
   the message-level note trigger (`ThreadView.tsx`'s `StickyNote` popover, currently sitting in the metadata
   row under the content — move it into the same rail, one consistent left-edge x-coordinate for every icon in
   it) — "whatever else wants a per-message affordance," per the original idea. Same pass: extend the highlight
   from last round (`.threadz-todo-line`/`.threadz-todo-token`) to the `@/todos <title>` trigger line too — it
   currently only matches bare `@/todo`, so a group header renders as plain text.
3. **Closed-todo filter: 3 states, and groups stop hiding their own items.** A `@/todos` card's items are no
   longer filtered at all — always shown in full inside the card; the closed filter only ever applied to
   flat/message entries and hiding some of a list you're looking at (groceries) reads as broken, not tidy.
   Replace the boolean `showClosed` toggle with three states — always show closed / never show closed / show
   only recently closed (default: recently — today's default, "hide immediately," was the complaint) — as an
   icon-segmented control, same fieldset-of-radio-icons pattern as `ThemeToggle`/the new `SidebarSwitcher`
   (`ThreadList.tsx`), not raw text. "Recently" needs a closed-at timestamp per entry: exact for a `MessageTodo`
   (`meta_edited_at`, already tracked, needs threading into `Todo`'s shape), approximate for a `LineTodo` (the
   message's `editedAt ?? createdAt` — loose on purpose, consistent with this file's other "a false positive
   here costs nothing" calls) — pick a window (24h is a reasonable default, not configurable, YAGNI) and say so
   in a comment.

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

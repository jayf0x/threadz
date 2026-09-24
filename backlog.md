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

1. **Done.** URL always reflects what's open; message selection is real, persistent, toggleable state, not a
   one-shot flash. `App.tsx` is now the one place that ever calls `history.pushState`/`replaceState` — a single
   effect mirrors `?thread=&msg=` from `selected`/`selectedMessageId` however they got there (a click, a todo
   jump, a deep link); `ThreadList.tsx`'s inline `history.pushState` for the Todos panel is gone, it just calls
   `onOpen` like every other navigation path now. Pure URL logic (`deepLinkSearch`/`deepLinkUrl`/`parseDeepLink`)
   lives in `lib/deepLink.ts`, tested in `deepLink.test.ts`. Added a `popstate` listener (not explicitly asked
   for, but pushState alone doesn't make the back button *do* anything without one) so back/forward actually
   step between threads, not just rewrite the address bar.
   `selectedMessageId: string | null` + `onSelectMessage: (id: string | null) => void` live in `App.tsx` right
   alongside `selected`/`openThreadAt`, passed down to `ThreadView` as a controlled prop + callback — same
   ownership pattern as threads, not a separate one. Thread-scoped: `openThreadAt`/`closeThread` (the latter
   replaces the old raw `setSelected(null)` at every call site — back arrow, Escape, delete, mode switch) clear
   it whenever the open thread changes; a plain in-thread click only ever touches `selectedMessageId` via
   `onSelectMessage`, never the thread or the URL's push/replace choice directly. Toggle (re-clicking the
   selected row clears it) is computed at the call site in `ThreadView.tsx`, not inside `EntryRow`.
   Visual split (point 4's "your call"): kept `.message-highlight`'s one-shot fade as-is in *spirit* but split
   it into `.message-selected` (persistent, steady tint, no animation — the row's baseline look while selected)
   and `.message-pulse` (the arrival keyframe, animating from a stronger tint down to `.message-selected`'s own
   steady value, so the two don't visibly disagree the instant the animation ends). `ThreadView.tsx` renders
   `EntryRow` with `selected`/`pulsing` (was one `highlighted` bool) — `pulsing` only ever true for a fresh
   navigational arrival (App.tsx's one-shot `pulseMessageId`, renamed from `scrollToMessageId`), never for a
   plain click. `EntryRow` is now exported (was module-private) so it's independently testable.
   Click-target discipline is a pure, exported guard (`rowSelect.ts`'s `shouldSelectRow` + the
   `ROW_SELECT_IGNORE` data-attribute marking the metadata bar as one zone) verified two ways, both real: a
   DOM-only test (`rowSelect.test.ts`, happy-dom, no React) covers the `editing`-blocks-everything case and the
   ignore-zone case including a nested target; a real component render (`EntryRow.test.tsx`, happy-dom +
   `@testing-library/react`, `@/features/editor` mocked out — Milkdown itself isn't what's under test) clicks
   the actual ⋯ trigger, note trigger, "edited" toggle, and plain content in the real tree and confirms
   selection fires only for the last one. happy-dom isn't otherwise wired into this repo's tests yet — the
   registration (skip Bun's own JS/timer globals, add everything happy-dom has that Bun doesn't, force-override
   `window`/`document`/`navigator`/`location`/`history`) lives at the top of `EntryRow.test.tsx`; worth lifting
   into a shared helper if a third test wants a headless render.
2. **Done: the full gutter.** A per-message left rail, not inline text decoration — the fix for last round's
   "checkbox floats next to the text" complaint that goes further than CSS-only: the checkbox is back, it just
   no longer renders *inside the text flow*. Mechanism, per line: a `Decoration.widget` (`todoDecoration.ts`,
   same primitive the CSS-only pass left in place) positioned `absolute; left: -20px; top: 50%; translateY(-50%)`
   relative to its own paragraph (`@/todo`) or list item (`@/todos` item — its `<li class="list-item">`, per
   `@milkdown/crepe/theme/common/list-item.css`, confirmed by reading that stylesheet rather than assuming: the
   `<ul>`/`<li>` carry no left padding of their own, the marker column is internal flex width) — both given
   `position: relative` in `markdown-editor.css` so the widget has something to anchor to; no DOM measurement,
   no separate gutter-column layout. `−20px` lands the checkbox in the app's own existing side padding
   (`px-6`/`md:px-10` on `ThreadView`'s scroll container, 24px/40px — comfortably more room than 20px, so it
   can't trigger a horizontal scrollbar there), not inside the message's own box. A click reports that line's
   index (`onTodoToggle` on `MarkdownEditor`, re-added — `ThreadView.tsx`'s `EntryRow` calls
   `onEdit(toggleTodoLine(m.content, lineIndex))`, the same `editMessage` path as any other edit).
   The same rail also hosts the message-level note trigger: `ThreadView.tsx`'s `StickyNote` `Popover.Trigger`
   moved out of the metadata row into an `absolute left-[-20px] top-5` button directly on `EntryRow`'s own
   `<article>` (now `position: relative`) — the identical `-20px` literal, by design: neither `<article>` nor
   `contentRef`'s `.threadz-md`/`.ProseMirror` (`--md-padding:0` there) has any left padding of its own, so both
   the React-positioned note button and the ProseMirror-decorated checkboxes read off the same x=0 and land at
   the same screen x despite being laid out through entirely separate mechanisms. `top-5` (20px) approximates
   the first line's vertical centre (`py-4`'s 16px top padding + roughly half a 15px/1.5 line box) — a fixed
   number, not measured, same reasoning as the checkbox's own non-measured positioning. Changing the rail's x
   means changing both literals (`markdown-editor.css`'s `.threadz-todo-checkbox` and `ThreadView.tsx`'s
   `left-[-20px]`) together, or the two rails stop lining up — flagged in both places' comments.
   A `@/todos <title>` header line gets the same `.threadz-todo-line`/`.threadz-todo-token` highlight as a bare
   `@/todo` now too (a second local regex in `todoDecoration.ts`, same lightweight-matcher convention as the
   existing one — `lib/todos.ts`'s own unexported `GROUP_TRIGGER` was deliberately left alone), but no checkbox
   of its own — it's a title, not a todo. Every item inside the group gets its own checkbox, individually
   toggleable. State is never cached: the plugin's `decorations()` calls `parseTodos`/`parseTodoGroups(value)`
   fresh on every ProseMirror state change (`value` itself always current — it's the same prop `MarkdownEditor`
   already keeps in sync via `replaceAll`), so a checkbox's open/closed rendering can't go stale across an edit;
   verified with a real (non-mocked) Crepe mount in `todoDecoration.test.tsx`, including that every gutter
   checkbox carries the row-select-ignore marker so clicking one can't also select the message row under it,
   and that omitting `onTodoToggle` (notes, scratch answers, history) renders the highlight with no checkbox.
3. **Done.** Closed-todo filter: 3 states, and groups stop hiding their own items. `TodosPanel.tsx`'s
   `GroupCard` now always renders every one of its `items`, regardless of the filter setting — and the card
   itself is never hidden either, even when every item is closed (the simple, consistent rule: a `@/todos` list
   is never touched by this filter at all, card or contents). The filter only ever applies to flat `LineTodo`/
   `MessageTodo` entries. The boolean `showClosed` is gone; `ClosedFilter = "always" | "never" | "recent"` (in
   `lib/todos.ts`, default `"recent"`) drives an icon-segmented 3-way control (`Eye`/`History`/`EyeOff`,
   `title`-only labels, no visible text) — same fieldset-of-radio-icons visual as `ThemeToggle`. `Todo`'s
   `LineTodo`/`MessageTodo` shapes gained a `closedAt: number` (not on `GroupTodo` — it needs no filter):
   exact for `MessageTodo` (the message's `metaEditedAt`, already tracked on the frontend `Message` type and
   populated from the backend's `meta_edited_at` — no plumbing needed, it just wasn't being read yet),
   approximate for `LineTodo` (`editedAt ?? createdAt`, loose on purpose, same "a false positive here costs
   nothing" philosophy as the file's other regexes). "Recently" window: `RECENT_CLOSED_MS` = 24h, not
   configurable (YAGNI). The filter predicate (`isTodoVisible`) lives in `lib/todos.ts` as a pure, exported
   function rather than inline in the component, so the 24h boundary is unit-tested directly
   (`todos.test.ts`) instead of needing a component-render test.

## Next — Copy pass: icon-first, kill redundant text (2026-09-24)

**Done.** A full sweep of every hardcoded label/title/hint/placeholder/button/menu/error string under
`frontend/src`, not just the five starting points below — see AGENTS.md's "UI copy" guideline (terse,
icon-first, no restating what's already obvious, "Local"/"Live"/"Offline" never "main") for the rule.

The five starting points, as landed:
- `ThreadList.tsx`'s `SidebarSwitcher` — visible `"Threads"`/`"Todos"`/`"Settings"` text dropped; each pill is
  now icon + `title` + `sr-only` label, same pattern as `ThemeToggle`. The `aria-label`-equivalent accessible
  name survives via the `sr-only` span, nothing lost for a screen reader.
- `SettingsPanel.tsx` — the `Eyebrow` "This device only" subtitle under the Settings heading is gone (the
  sidebar switcher already establishes the panel). Backend URL field's hint cut from a three-clause paragraph
  to "Override if the app can't reach it automatically." The naming toggle's hint was left untouched, per the
  guideline's own example of a hint that earns its place.
- `ConnectionDialog.tsx` — rewritten. Eyebrow is now exactly `"Local"` / `"Live"` / `"Offline"` (StatusPill's
  own three words) instead of `"Local · this device"` / `"Live · main"` / `"Live · offline"`. Headers: "Back
  online." / "Working offline." / "Connected." / "Can't connect." (was "Main is back."/"Can't reach main."/
  etc). Every body paragraph cut to one short clause ("Notes save here until you sync.", "Saves directly.
  Falls back to this device if the connection drops.", "You choose when to sync back." — the "switch on
  purpose, say before you go offline" scene-setting dropped). `connectionCopy.ts`'s `describeReport` (the
  post-sync summary line) also rewritten without "main" ("Sent 3 changes." / "deleted remotely" / etc, was
  "Sent 3 changes to main." / "deleted on main"). `StatusPill.tsx`'s `title` hints: "Working locally.
  Reachable — open to sync." / "Live. Open to work locally." / "Unreachable. Open for options." (was "Main is
  reachable"/"Live on main"/"Main is unreachable"), plus its `sr-only` "changes not on main" → "changes not
  yet synced".
- `ThreadView.tsx`'s ⋯ menu — "Copy thread from here" → "Copy here". "Add to Todos"/"Remove from Todos" → one
  word ("Todo") with the icon carrying the add/remove distinction: `Square` (not flagged, click to add) /
  `SquareCheck` (flagged, click to remove) — reusing the same checkbox visual language `TodosPanel.tsx`
  already uses for open/closed, instead of introducing a new icon (`StickyNotePlus`/`NotebookPen` would have
  read as "notes", a different concept already owned by the per-message `StickyNote` popover). `Composer.tsx`'s
  own ⋯ menu ("Copy thread from here", the same action from the composer) got the same "Copy here" treatment
  for consistency.
- `TodosPanel.tsx` — already compliant on inspection (open/closed counts are a terse `Eyebrow` string, the
  closed-filter switcher is already icon + `title` + `sr-only`, no visible label). No change needed.

Found and fixed beyond the five starting points (the same "main" leak, missed by the known-offenders list):
- `ThreadRow.tsx`'s delete confirmation (local mode): "leaves this device now and **main** on the next sync"
  → "leaves this device now, and everywhere else on the next sync".
- `lib/local.ts`'s local-mode `ask()` rejection: "Claude needs the **main** backend — go live to ask." →
  "Claude isn't available offline — go live to ask." (surfaces as a real error if Ask is ever reached in local
  mode).
- `lib/handoff.ts`: the sync-in-progress phase label `"Reading main…"` (shown as the button's own text while
  busy) → `"Reading…"`; the "no device copy yet" error `"Connect to main once first…"` → `"Connect once
  first…"`; the retry-loop error `"Main kept changing while syncing…"` → `"Kept changing while syncing…"`.

Everywhere else checked and left as-is: `Composer.tsx`'s Note/Ask mode toggle and "Keep exchange in thread"
checkbox (real distinct behavior, not restating an icon); `MessageInput.tsx`, `ImageButton`, `Field`, `Button`,
`Select`, `Input`, `Eyebrow`, `VoiceSettings.tsx`, `VoiceMeter.tsx`, `App.tsx`'s blank-state shortcuts hint —
all either icon-only with a real `aria-label`/`title` already, or short text that isn't restating anything.
`lib/status.ts`, `lib/replica.ts`, `lib/api.ts`, `lib/images.ts`, `lib/mode.ts` and code comments throughout
keep "main" — internal/engineer-facing, per AGENTS.md, never rendered.

Guardrail held: every place a visible label was removed (`SidebarSwitcher`) kept its accessible name via a
`sr-only` span, same as `ThemeToggle`. No component was restructured beyond the text/icon change itself.

Verified: `bun run check` (typecheck + Biome + token lint + 181 tests, all green) and
`bun run --cwd frontend build`, both clean. No test asserted on any of the exact strings changed, so nothing
needed updating on that side.

## Known issues

- **`EntryRow.test.tsx` logs a React `act(...)` warning** (Radix `Popover`'s `PopperContent` updating state
  outside `act`) on every run — pre-existing, unrelated to any recent change; tests still pass. Noticed while
  landing the Appearance/theming work (2026-09-24), not touched then since it's unrelated to that change.

## Items - v1.5

Surfaced 2026-09-24, out of a "what could we build next, local-only, no AI" pass over `inspiration.md`, `backlog.md`
and a fresh read of the current code. Nine items, all meant to be built — **do not skip any of them.** Unlike
every other section in this file, this one carries its own execution plan (below) instead of leaving sequencing to
whoever picks it up: independent groundwork runs first, in parallel, isolated (worktrees); once every piece of
groundwork is merged back, the remaining integration work goes sequentially, one item (or paired items) at a time,
each its own sub-agent, in the fixed order below — no one needs to sit and say "now do the next one." None of
these need main reachable except where noted; all are meant to work the same in Local and Live unless flagged.

### Decisions (resolved 2026-09-24, before handing this off)

Four questions were genuinely open and got asked and answered before writing the plan below; a fifth was resolved
by reading the code, not asked. Treat all five as settled — don't re-litigate them mid-build.

1. **Reference format:** the hybrid. A trigger fires the live autocomplete while typing (CLI-`cd`-style, see the
   References item), but what actually gets inserted into the text is a real markdown link (`[text](...)`) — there
   is only ever one stored representation, the trigger is a typing-time affordance only, never itself saved. This
   gets Crepe's existing link rendering for free (no new node type) and degrades to a plain, if inert, link in any
   other markdown viewer. Still open, left to whoever builds it: the exact URL-scheme spelling inside the
   parentheses, and whether message *ranges* (not just a single message) are in v1 or a fast-follow — starting
   with a single target and treating ranges as a fast-follow is the reasonable default absent a reason not to.
2. **Pin sync:** per-device only, not synced — same `localStorage`/`useSyncExternalStore` shape as
   `lib/threadOrder.ts`'s existing per-thread reverse-order flag. No `Thread` schema change, no sync/merge rule.
3. **Resurfacing data:** reuse existing `createdAt`/`updatedAt`, no new "last viewed" field. Weaker signal (an
   edit moves `updatedAt` same as opening it would have) but zero schema change and nothing new to carry through
   sync — acceptable for a first cut.
4. **Reference scope:** local-copy-only. Autocomplete only ever offers threads/messages already in this device's
   copy (`lib/local.ts`'s `exportSnapshot`) — same as everything else in this app that reads device-local state.
   No fetch-on-demand for a thread this device hasn't synced yet.
5. **Recently Deleted / Live-mode restore — resolved by reading `backend/db.ts`, not asked:** main's `deleteThread`
   is a hard SQL `DELETE` (`backend/db.ts:389-391`), no soft-delete, no trash-equivalent on main. So Live-mode
   restore can only ever work for a thread still sitting in *this device's own* `trash` from before its delete
   synced — once a delete reaches main, it's gone everywhere, permanently. Build the feature around that
   constraint, don't try to make it symmetric with something main doesn't support.

One thing explicitly **not** resolved, deliberately deferred rather than built: the "breadcrumb when content
moves" sub-part of the Zulip-style item below depends on Branching (parent pointers, sub-threads — see
`inspiration.md`'s Branching sections), which doesn't exist yet and isn't itself part of this v1.5 list. Skip
that one sub-clause explicitly (it's called out again in the item itself) rather than building a half-version of
it against nothing — this is the one documented exception to "do all of these."

### Execution plan

**Phase 1 — independent groundwork, worktree-isolated, runs in parallel.** Each slice below touches only new or
pure/logic-only files (no shared UI files — `ThreadRow.tsx`/`ThreadList.tsx`/`ThreadView.tsx`/`visibleThreads.ts`
are untouched in this phase), so none of these can conflict with each other; merge each back to the main branch
as it lands rather than waiting for all seven. Kick off (G) first/earliest — it's by far the largest and most
likely to take longest, so it shouldn't be the thing everything else waits on starting.

- (A) A generic per-thread, per-device boolean-flag store (same shape as `lib/threadOrder.ts`) — backs both **Pin**
  and **Resolved/unresolved status** below; build it once, generically (a flag *name* plus thread id), not as two
  separate one-off stores.
  **Done:** `lib/threadFlags.ts` (`isThreadFlagSet`/`setThreadFlag`/`useThreadFlag`), generalizing `threadOrder.ts`'s
  shape to a flag name plus thread id in one `localStorage` store. `threadFlags.test.ts` covers default-false,
  set/unset, and independence both across threads and across flags on the same thread.
- (B) `lib/local.ts`: a new export to *list* trashed threads (the `trash` store already exists; a query surface
  over it likely doesn't) — backs **Recently Deleted**.
  **Done:** `local.ts`'s `listTrash()`, a read-only query over the existing `trash` store returning
  `{ id, title, deletedAt }[]`, newest deletion first. Covered in `local.test.ts`.
- (C) A reusable toast/snackbar primitive, `components/ui/toast.tsx` on `@radix-ui/react-toast` (new dependency;
  not yet installed) — backs **Undo toast**, and is generically reusable afterward.
  **Done:** `components/ui/toast.tsx` — `toast({ title, description?, action?, duration? })` plus a `useToast()`
  hook, backed by a module-level store (`useSyncExternalStore`, same shape as `lib/status.ts`) so it can be called
  from anywhere without a context lookup. `ToastProvider` renders the queue via Radix's `Root`/`Viewport`, reuses
  the existing `.rise` entrance keyframe. **Not yet mounted** — `ToastProvider` still needs wrapping around the app
  root (`main.tsx`/`App.tsx`); left for the Phase 2 step that actually consumes it.
- (D) `lib/search.ts`: typo-tolerant `matchScore` (small edit-distance or subsequence match, replacing the current
  exact-substring check) — backs **Typo-tolerant search** and, later, **Command palette**.
  **Done:** `matchScore` is now tiered — an exact substring match still wins outright (unchanged formula), and
  failing that a fuzzy fallback requires every needle word to match some haystack word either as a substring/prefix
  or within a length-proportional edit-distance budget (a hand-written restricted Damerau-Levenshtein, so a
  transposition typo like "hte"→"the" costs 1, not 2). Same signature, so `visibleThreads.ts` needed zero changes.
  10 new cases in `search.test.ts` (typo, transposition, reordered words, partial word, exact-still-outranks-fuzzy).
- (E) A pure thread → markdown-string assembly function — backs **Export one thread as markdown**.
  **Done:** `lib/exportMarkdown.ts`'s `exportThreadMarkdown(thread, messages, annotations)` — one `##` heading per
  message (role + human timestamp), `---`-separated, annotations inlined as a blockquote under their message,
  image refs left as the literal `img:<hash>#WxH` markdown. Covered in `exportMarkdown.test.ts`.
- (F) A pure weighted-pick function over existing timestamps (decision 3 above: no new field) — backs
  **Resurfacing**.
  **Done:** `lib/resurfacing.ts`'s `pickResurfacingThread(threads, rand?, now?)` — weighted-random draw over
  staleness since `updatedAt` (older/less-recent weighted higher, never strictly oldest-first). `rand`/`now` are
  injectable so `resurfacing.test.ts`'s statistical trials are deterministic (seeded PRNG), not flaky.
- (G) **References** core: the format (decision 1), the parser for detecting a completed reference in text, the
  trigger-driven two-stage autocomplete (thread titles, then that thread's messages, Tab/Enter to complete at each
  stage, Esc/outside-click to cancel at whatever stage without forcing the next one, editable afterward — full
  behavior spec is in the References item below), wired into both the raw-edit path and the live Milkdown/Crepe
  view, plus in-app click-to-navigate (reusing `App.tsx`'s `openThreadAt`). **Needs at least one real end-to-end
  test** (type a reference, autocomplete it, click it, land on the right thread/message) — this is explicitly
  called out because everything else in this plan is small enough for a unit test to cover its logic, this one
  isn't. The "Copy link" ⋯-menu action is *not* part of this groundwork slice — it's cheap, and it depends on this
  slice existing, so it's a Phase 2 step instead.
  **Done:** trigger is `[[` (not `@`, which `@/todo` already owns). Format landed on `thread=<id>` /
  `thread=<id>?message=<id>` — verified against `@milkdown/preset-commonmark`'s actual `sanitizeLinkHref` (blanks
  any `scheme:`-shaped href not on an allow-list, which would have silently broken the originally-floated
  `link:{thread}/{message}` spelling), range-ready via a future `?message=<from>..<to>`. `lib/references.ts` is the
  pure core (format, `findReferences` parser, the `nextAutocompleteState` two-stage state machine shared by both
  editor adapters, local-only `searchThreads`/`searchMessages`); `features/editor/{referencePlugin,
  useReferenceAutocomplete, ReferenceAutocompleteMenu, referenceKeyboard, caretCoordinates}.ts(x)` wire it into
  both `RawEditor`'s textarea and `CrepeEditor`'s live ProseMirror view, plus click-to-navigate via `App.tsx`'s
  `openThreadAt`, threaded through `ThreadView`/`Composer`/`MessageInput`. Required end-to-end test is
  `references.e2e.test.tsx` (full two-stage flow + click-to-navigate, plus an Esc-mid-stage-two case) — needed
  `bun test --isolate` (now the default in `package.json`'s `test`/`check` scripts) to stop parallel happy-dom test
  files from clobbering each other's `window`/`indexedDB`. Copy link and message ranges remain Phase 2/fast-follow,
  as scoped.

**Phase 2 — sequential integration, ordered, one sub-agent per step (pairs share a step where they share both
groundwork and touched files), only starts once every Phase 1 slice above is merged:**

1. **Undo toast + Recently Deleted/Restore**, together — both touch `ThreadRow.tsx`'s delete flow and both build
   directly on the same `trash` mechanism, so land them in the same pass rather than touching that flow twice.
2. **Pin + Resolved/unresolved status**, together — both consume groundwork slice (A) and both touch
   `ThreadRow.tsx`/`visibleThreads.ts`/`ThreadList.tsx`; the permalinks sub-part of the original Zulip item is
   *not* a separate step here — it's absorbed into the References format (decision 1: a markdown link to a
   specific message id already *is* a stable permalink), and the breadcrumb sub-part is skipped per the Decisions
   section above.
3. **Command palette** — depends on groundwork slice (D) already being merged. The **typo-tolerant search** item
   itself needs no separate step here: it's fully resolved by its own Phase 1 groundwork (D) already being wired
   into `visibleThreads.ts`, which it already consumes today — this step is really just Command palette, with
   search's groundwork as a prerequisite, not a second piece of work.
   **Done:** `features/palette/CommandPalette.tsx`, a Radix `@radix-ui/react-dialog` (new dependency) mounted at
   `App.tsx`'s top level next to `ConnectionDialog`, so ⌘K/Ctrl+K works from anywhere and survives the mode-keyed
   `Shell` remount. Its own `keydown` listener follows `ThreadList.tsx`'s `/`/`n` precedent exactly (guarded by
   `lib/dom.ts`'s `shortcutBlocked`). Keeps its own `getThreads()` + `onChange` subscription warm all session
   (same pairing `useThreads.ts` uses) and ranks title matches with `lib/search.ts`'s `matchScore` — no new
   matching logic. Arrow keys move the highlight, Enter opens the highlighted thread via `App.tsx`'s
   `openThreadAt` and closes the palette, Esc closes it (Radix's default `onEscapeKeyDown`).
4. **Export one thread as markdown** — wire groundwork slice (E) into a per-thread action (⋯ menu on `ThreadRow`,
   following the same pattern `ThreadView.tsx`'s message-level `Menu` already uses) and `handoff.ts`'s `download`.
   **Done:** a plain icon button on `ThreadRow.tsx`'s existing action row, not a new ⋯ menu (one action didn't
   earn a dropdown). Fetches through the same mode-aware `api.getThread(id)` Regenerate-title already uses,
   formats with `exportMarkdown.ts`'s `exportThreadMarkdown`, and saves via `handoff.ts`'s `download` (now takes
   an optional mime `type`, default unchanged, so the vault-backup caller needed no changes).
5. **Resurfacing** — wire groundwork slice (F) into somewhere low-friction (opening the app, an idle sidebar
   moment — left as a judgment call, not decided here).
   **Done:** a quiet row at the bottom of `ThreadList.tsx`'s index (`useResurfacingThread`, same file) — "You
   wrote this a while back" plus the thread's title, opened via `App.tsx`'s `openThreadAt` like any other row.
   Picked from `useThreads.ts`'s new `allThreads` (the unfiltered set it already had in hand, no second fetch)
   once per session — a `useRef` gate keeps the effect from re-rolling as `threads` changes underneath it (sync,
   edits, search). Hidden while searching (`!query`) so it never mixes into search results; not shown as its own
   panel/idle-timer since the index was the lowest-effort, always-visible surface that didn't need new
   idle-detection plumbing (none exists elsewhere in the codebase).
6. **References: Copy link + final integration polish** — the "Copy link" ⋯-menu action (message and thread),
   plus closing out anything Phase 1's slice (G) left as a fast-follow (e.g. range support, if not done already).
   **Done:** a "Copy link" item in `ThreadView.tsx`'s `EntryRow` message ⋯ menu writes
   `[<snippet>](thread=<id>?message=<id>)` to the clipboard (`lib/references.ts`'s `messageSnippet` for the link
   text, `buildReferenceHref` for the href — the same shape the autocomplete itself produces, ready to paste
   straight into another note rather than a bare URL). `ThreadRow.tsx` gets the thread-level equivalent
   (`[<title>](thread=<id>)`), but not as a seventh standalone icon button: the row was already at six
   (Pin/Resolved/Rename/Regenerate/Export/Delete), and touch devices show every one of them unconditionally
   (`[@media(hover:none)]:opacity-100`), so a seventh tipped it from fuller into genuinely crowded. Rename,
   Export as Markdown, Copy link and Delete moved into a new `Menu` (⋯, the same `components/ui/menu.tsx`
   primitive `EntryRow`'s own message menu already uses); Pin, Resolved and Regenerate title stay standalone —
   the first two are glanceable toggle state, the third keeps its own `animate-pulse` busy indicator, which a
   menu item can't show once Radix auto-closes the menu on select. Both Copy link actions fire a quiet
   `toast({ title: "Link copied" })` (`components/ui/toast.tsx`, the same primitive Undo already uses) on
   success, or a `"Copy failed"` toast with the error if `navigator.clipboard.writeText` rejects — no
   clipboard-copy pattern existed anywhere else in the app to match, so this is the first. Range support
   (`?message=<from>..<to>`, flagged as forward-compatible in `lib/references.ts`'s own comment) is the one
   piece left from Phase 1 slice (G) — not picked up here: it needs its own autocomplete UX for picking a
   range, not just a format change, so it isn't the "trivial" case this step was scoped to absorb. Verified:
   `bun run check` (typecheck + Biome + token lint + 230 tests, all green) and `bun run --cwd frontend build`,
   both clean.

- **Pin a thread.** No folder hierarchy exists (by design) and sort is only Recent/Newest/A–Z
  (`frontend/src/features/threads/visibleThreads.ts`'s `SORTS`) — there is currently no way to keep a few live
  threads always at the top regardless of sort/search. `inspiration.md`'s "What folders did, and what could
  replace it" names pinning as one of the mechanisms that could replace folder-based scoping. Likely shape: a
  device-local flag, same pattern as `frontend/src/lib/threadOrder.ts`'s per-thread reverse-order setting
  (`localStorage` + typed getter/setter + `useSyncExternalStore`, keyed by thread id) rather than a new `Thread`
  schema field. **Resolved (Decisions #2): per-device, not synced.** Groundwork: Phase 1 slice (A), shared with
  Resolved/unresolved status below. Integration: Phase 2 step 2, paired with Resolved/unresolved status.
  **Done:** `ThreadRow.tsx`'s ⋯-style action row gets a `Pin` toggle (`lib/threadFlags.ts`'s `"pinned"` flag,
  filled + `text-primary` once set, visible even without hovering the row — unlike the always-hover-only rename/
  delete actions). `visibleThreads.ts`'s `visibleThreads()` takes an optional `pinned` id set and stable-
  partitions the already-sorted/ranked result so pinned matches float to the top ahead of everything else,
  in both the plain-sort and search-ranked paths, without disturbing relative order within either group.
  `useThreads.ts` supplies that set via `threadFlags.ts`'s new `useFlaggedThreadIds()` hook.

- **Recently Deleted, with restore.** The data model already fully supports this and is unused by any UI: for
  Local, `frontend/src/lib/local.ts`'s `trash` IndexedDB store (keyed by thread id, a `dirty` flag, and
  resurrection logic — see `local.ts`'s "Main deleted a thread we last saw" handling and the `resurrected` return
  value) already exists and is exercised by `local.test.ts`. Right now `ThreadRow.tsx`'s delete action
  (`api.deleteThread`) looks final from the user's side even though the device copy quietly keeps the trashed
  thread. Feature: a view listing recently-deleted threads (a new sidebar panel, same pattern as
  `frontend/src/features/todos/TodosPanel.tsx`, or a mode of the existing Index) with a restore action per row.
  **Live-mode restore, resolved (Decisions #5):** main hard-deletes, no trash-equivalent — restore only ever works
  for a thread still sitting in this device's own `trash` from before its delete synced, never a general "undelete
  on main." Groundwork: Phase 1 slice (B), a `local.ts` export to *list* trashed threads (the store exists, a
  query surface over it likely doesn't). Integration: Phase 2 step 1, paired with Undo toast.
  **Done:** a fourth sidebar panel (`features/trash/TrashPanel.tsx`, `Trash2` icon, icon-only per the
  `SidebarSwitcher` convention) lists `listTrash()`, newest deletion first, with a restore button per row.
  `local.ts`'s `restoreFromTrash(id)` is the exact inverse of `deleteThread` (puts the thread/messages/annotations
  back, marked dirty, drops the trash row); `handoff.ts`'s `restoreThread(id)` wraps it mode-aware — local mode's
  read is the device copy so that's the whole story, live mode additionally runs `syncNow()` since main keeps no
  trash of its own to undelete from. Restoring reopens the thread via the row's existing `onClick`.

- **Command palette / quick switcher.** The sidebar search box (`ThreadList.tsx`) works but needs navigating to
  first; a keyboard-triggered overlay reachable from anywhere (⌘K-style: type, fuzzy-match thread titles, Enter
  opens it) would match the app's existing "capture in seconds" bar for retrieval, not just capture. The `/` and
  `n` global shortcuts already live in `ThreadList.tsx`'s top-level `keydown` listener, guarded by
  `frontend/src/lib/dom.ts`'s `shortcutBlocked` (so they don't fire while typing in an input/editor) — a new
  shortcut would follow that exact precedent. No overlay-dialog component exists yet for this; per AGENTS.md's
  "Menus, popovers, dropdowns, dialogs: a real primitives library, never hand-rolled" rule, this means reaching
  for `@radix-ui/react-dialog` (not yet a dependency — `@radix-ui/react-dropdown-menu` and
  `@radix-ui/react-popover` are, `-dialog` isn't) rather than hand-rolling one. Shares its matching logic with the
  "typo-tolerant local search" item below rather than reinventing it. Groundwork: none of its own — depends on
  Phase 1 slice (D). Integration: Phase 2 step 3.
  **Done:** `features/palette/CommandPalette.tsx`, mounted at `App.tsx`'s top level (alongside `ConnectionDialog`)
  so it's reachable from anywhere, not scoped to `ThreadList.tsx`'s tree. ⌘K/Ctrl+K toggles it via a top-level
  `keydown` listener guarded by `lib/dom.ts`'s `shortcutBlocked`, same precedent as the `/`/`n` shortcuts. A Radix
  `Dialog` (`@radix-ui/react-dialog`, newly added), not hand-rolled, per AGENTS.md. Matches thread titles with
  `lib/search.ts`'s `matchScore` — the same typo-tolerant scorer `visibleThreads.ts` uses, not reinvented. Arrow
  keys move the highlight, Enter opens the highlighted thread through `App.tsx`'s `openThreadAt` (the same
  navigation path References/Todos/deep links use) and closes the palette, Esc closes it.

- **Typo-tolerant local search.** `frontend/src/lib/search.ts`'s `matchScore` is exact-substring-only
  (`hay.indexOf(needle)`) — no fuzzy/typo tolerance. `inspiration.md`'s research on Mem (a similar app) already
  logged "unreliable AI search and weak exact-keyword search" as a real user complaint from that space. This is
  the local, no-model fix for the "weak exact-keyword search" half of that lesson: a kinder matcher (small
  edit-distance tolerance, or a subsequence match) so a typo or a partial/reordered word still surfaces the right
  thread. Touches `lib/search.ts` (`matchScore`/`combineScore`), consumed by `visibleThreads.ts` (title-only,
  local) — check whether the backend's own SQLite FTS5 `bm25()` content-search path (referenced in `search.ts`'s
  own top comment) should get equivalent forgiveness too, or whether that's a separate, larger change out of
  scope for this item. **Already (mostly) resolved by its own groundwork:** Phase 1 slice (D) is this item — once
  it's merged, `visibleThreads.ts` already consumes `matchScore` today, so there's no separate Phase 2 step for
  this one specifically; Command palette (above) is the only thing still waiting on it.

- **Resurfacing (decaying-recall, local-only).** `inspiration.md`'s "Ideas that came out" section names
  Readwise's resurfacing-by-decaying-recall-probability (not by date) as a lesson worth carrying over, but files
  it right next to the AI-powered "nightly dream pass" idea — worth separating: the resurfacing *mechanic itself*
  is just a scored/weighted pick over existing timestamps, no model or embedding involved. Feature: somewhere
  low-friction (opening the app, an idle sidebar moment) surface one older thread or note "you wrote a while back"
  instead of nothing, weighted so older/less-recently-seen things resurface more often than a flat random pick,
  but not strictly oldest-first either. **Resolved (Decisions #3): reuse existing `createdAt`/`updatedAt`, no new
  field.** Groundwork: Phase 1 slice (F), a pure weighted-pick function. Integration: Phase 2 step 5 — where
  exactly it surfaces (app open, idle sidebar moment, elsewhere) is left as a judgment call for that step.
  **Done:** surfaces as a quiet row at the bottom of `ThreadList.tsx`'s index — "You wrote this a while back"
  plus the thread's title, opening it via `App.tsx`'s `openThreadAt`. Picked once per session
  (`useResurfacingThread` in `ThreadList.tsx`, a `useRef`-gated effect over `useThreads.ts`'s new `allThreads`
  field — the unfiltered list it already fetches, so no second `getThreads()` call) rather than re-rolled on
  every render. Chose the index over an idle-sidebar timer: no idle-detection pattern exists elsewhere in the
  codebase, and the index is already the always-visible, low-friction surface the other four steps built on.

- **Zulip-style thread status and stable links.** Three related, already-researched ideas from `inspiration.md`'s
  Zulip section ("Links survive", "Status in the label", "Breadcrumbs"), promoted here from "parked" to "worth
  scoping": (1) a **resolved/unresolved status** on a thread — a quiet marker (Zulip prepends ✔ to the topic name)
  plus a filter, the most standalone/buildable of the three (just a boolean-ish field on `Thread` and a filter in
  `visibleThreads.ts`/`ThreadList.tsx`); (2) **permalinks that survive edits** — a link to one specific message
  that keeps working even if the thread's content around it changes (link by message id, which the app already
  has, not by position); (3) an automatic **breadcrumb when content moves** — most relevant once Branching or
  Copy-with-provenance exists (see `inspiration.md`'s "Provenance for Copy" and the Branching sections). **(3) is
  the one documented exception to "build all of these" — explicitly skipped, blocked on Branching (not part of
  this list, no ETA); don't build a half-version against nothing.** **(2), resolved:** absorbed into the
  References item's link format (Decisions #1) — a markdown link to a specific message id already is a stable
  permalink, no separate mechanism needed. So only **(1) resolved/unresolved status** is actual new work here.
  Groundwork: Phase 1 slice (A), shared with Pin above. Integration: Phase 2 step 2, paired with Pin.
  **Done:** same `ThreadRow.tsx` action row gets a `Check` toggle (`lib/threadFlags.ts`'s `"resolved"` flag),
  and a resolved thread shows a small muted `Check` mark prepended to its title (Zulip's ✔-prefix convention,
  reusing the app's own icon set rather than a literal checkmark glyph) — quiet by design, no separate badge or
  color change. `ThreadList.tsx` gets a two-way `EyeOff`/`Eye` segmented filter (`ResolvedFilterSwitcher`, same
  icon-only fieldset pattern as `SidebarSwitcher`/`TodosPanel`'s closed-todo filter) next to the sort `Select`,
  defaulting to "active" (resolved hidden); `visibleThreads.ts` grew a generic `hidden` id-set parameter (not
  resolved-specific) that drops those ids before sorting/ranking, and `useThreads.ts` feeds it the resolved set
  only when the filter is set to hide them.

- **Export one thread as portable markdown.** Today's only export is the whole-vault JSON backup
  (`frontend/src/features/connection/BackupSection.tsx`, `frontend/src/lib/handoff.ts`'s `exportBackup`/`download`)
  — there's no way to get a single thread out as a real, shareable or printable markdown file, which is the more
  natural unit for "replace Obsidian" than a full-vault dump. Feature: a per-thread "Export" or "Copy as Markdown"
  action (the message-level ⋯ menu, `frontend/src/features/threads/ThreadView.tsx`'s `Menu` usage, is the existing
  precedent for a per-item action menu; `ThreadRow.tsx` would need an equivalent for thread-level actions if one
  doesn't already exist there). `handoff.ts`'s `download` helper already exists and is reusable for a `.md` file,
  not just the JSON export. Thread content is already plain markdown messages, so this is mostly an assembly/
  formatting question left open: one message per line vs. per section, whether to include timestamps, whether to
  inline annotations/notes or drop them, whether images (referenced only as `img:<hash>` per AGENTS.md's Images
  section) get resolved to something in the output or left as broken references. Groundwork: Phase 1 slice (E), a
  pure assembly function. Integration: Phase 2 step 4.
  **Done:** a plain `Download` icon button in `ThreadRow.tsx`'s existing action row (next to Regenerate title,
  before Delete) — a sixth icon button read better than a new ⋯ menu for one action, so `pr-36`/`pr-40` on the
  title's reserved space is the only layout change. Fetches via the same mode-aware `api.getThread(id)` the
  Regenerate-title action already uses (live or local through `api.ts`'s `via()`, no new path), hands
  `{ messages, annotations }` straight to `exportMarkdown.ts`'s already-tested `exportThreadMarkdown`, and saves
  the result with `handoff.ts`'s `download` — which gained an optional `type` param (default `application/json`,
  unchanged for the existing backup) so a `.md` file can carry `text/markdown` instead of being mislabeled JSON.
  Filename is the thread title with filesystem-unsafe characters collapsed to `-` and a `.md` extension.

- **Undo toast on delete.** `local.ts`'s `trash` mechanism (see "Recently Deleted" above) already means a delete
  isn't actually destructive underneath, but `ThreadRow.tsx`'s delete flow (a `confirm()` dialog today) gives no
  way back in the moment it happens. `inspiration.md`'s "Ideas parked for later" already names "Undo toast for
  Copy" as a parked idea; this is the same UI pattern applied to Delete instead — arguably higher-value, since
  Delete already has `trash` to undo *into*, where Copy has no real "undo" target. No toast/snackbar primitive
  exists anywhere in `frontend/src/components/ui/` today — this would likely be the first, and per AGENTS.md's
  primitives rule should probably be built on a Radix pattern (`@radix-ui/react-toast` isn't a dependency yet)
  rather than hand-rolled, same reasoning as the command-palette item above. Groundwork: Phase 1 slice (C), the
  primitive component on its own. Integration: Phase 2 step 1, paired with Recently Deleted/Restore.
  **Done:** `ThreadRow.tsx`'s `confirm()` dialog is gone — delete now happens immediately (it was already
  non-destructive underneath) and fires a `toast()` with an "Undo" action that calls `restoreThread` and reopens
  the thread. `ToastProvider` is now mounted at the app root (`App.tsx`, wrapping `LazyMotion`).

- **References: linking a thread or a specific message, inline.** Scoped down deliberately from a bigger, later
  idea — read `inspiration.md`'s new "References" entry (added alongside this backlog item) for the full,
  deferred vision (linking *everything* — notes, threads, messages, whatever else the app eventually has — plus a
  cross-content browser); this item is only the buildable slice: referencing another **thread** or a **specific
  message** from inside a note/message, inline, clickable. Four sub-parts; the first and fourth are resolved
  (Decisions #1 and #4 above), the middle two are the actual work:
  1. **Format — resolved (Decisions #1): the hybrid.** A trigger character fires live autocomplete while typing
     (see (2) below); what actually lands in the text once completed is a real markdown link,
     `[custom text](...)` — a single stored representation, never the trigger syntax itself. Two things still left
     to whoever builds this: (i) the exact URL-scheme spelling inside the parentheses — `thread={id}?message={id}`
     and `link:{thread_id}/{message_id}` were both floated, a range-capable shape
     (`link:{thread_id}/{from}-{to}`) is worth having in mind even if range support itself is a fast-follow, so
     the scheme doesn't need a breaking change to add it later; (ii) confirm against `@milkdown/crepe`'s actual
     link/autolink handling that this doesn't collide with anything Crepe already parses as something else —
     Crepe already renders a plain `[text](url)` as a clickable link with zero new node types needed, which is
     exactly why the hybrid was chosen, but verify rather than assume. Should navigate in-app (reuse `App.tsx`'s
     `openThreadAt`/deep-link machinery), not a hard page reload.
  2. **Autocomplete**, live and fully local — per Decisions #4, scoped to whatever this device's copy already
     holds (`lib/local.ts`'s `exportSnapshot`/`pullMain`), no fetch-on-demand for a thread not yet synced here.
     Typed from the trigger in (1). Must work anywhere text is composed or edited — the composer (`Composer`/
     `MessageInput`), a message's inline edit mode, and the note popover's editor (`ThreadView.tsx`'s `EntryRow`)
     — meaning it likely needs to hook into both the raw-textarea edit path and the live Milkdown/Crepe view (see
     AGENTS.md's "Custom rendering inside the Milkdown view" conventions for how existing decorations/node-views
     are wired in — `todoDecoration.ts` is probably the closer precedent than `imageView.ts`, since a reference
     isn't a real markdown AST node either). Exact behavior, CLI-`cd`-tab-completion-style, spec'd already: first
     shows truncated thread titles (same truncation the sidebar already applies); Enter or Tab completes the
     thread reference and *continues* autocompleting into that thread's messages next; Esc or an outside click
     stops the autocomplete entirely at whatever stage it's at — critically, Esc right after the thread-level
     completion must leave a thread-only reference behind, not force a message id onto it. An already-completed
     reference sitting in existing text must remain editable afterward, not a one-shot locked-in widget.
  3. **Done: Copy link.** A "Copy link" action on both a message and a thread (the existing ⋯ menus —
     `ThreadView.tsx`'s `EntryRow` message menu, and a thread-row equivalent — are the natural home) that copies
     the reference to the clipboard already formatted per (1), ready to paste straight into another note. See
     the execution plan's Phase 2 step 6 above for the full write-up (format, where each action lives, feedback,
     and why range support stayed a deferred fast-follow).
  4. **Local/Live scope — resolved (Decisions #4):** local-copy-only, no fetch-on-demand. Groundwork: Phase 1
     slice (G) — parts 1 and 2 above, plus the required end-to-end test. Integration: Phase 2 step 6 — part 3
     (Copy link) plus any fast-follow (range support) left over from slice (G).

## V1.6 — mobile QA pass

From a real-phone QA session (2026-09-24). Goal: more intuitive, coherent, mobile-friendly UX.

1. **Remove the sidebar footer bar** (StatusPill + sync refresh + ThemeToggle) — its own bottom bar on
   mobile, a cramped row under the index on desktop. Fold it into Settings instead:
   - Light/dark under the Appearance section's palette picker.
   - A new first Settings section for sync/connection status — status only, minimal copy, opens the
     existing `ConnectionDialog` for the real actions.
   - Import/export moves to its own section near the bottom of Settings (low-usage functionality).
2. **Composer spacing/alignment.** Too much surrounding whitespace, especially on mobile. Fold the "+"
   attach button and the "…" overflow menu in with the image/mic actions, bottom-aligned,
   `justify-between`; cap primary actions at 3, everything else moves into the overflow menu.
3. **Mobile scroll/overflow — likely fixed, needs a real phone to confirm.** The input bar was
   already outside the scrollable message list (`ThreadView.tsx`'s layout only ever meant the
   thread to scroll); the described bug — everything looks like it's overflowing after the
   keyboard shows/hides, fixed only by pinching back out — matches iOS Safari's documented
   auto-zoom-on-focus behavior for any focused field under 16px, which it doesn't always cleanly
   reverse on blur. The editor (`--crepe-base-font-size: 15px`) and the shared `Input`/`Textarea`/
   `Select` primitives were all under 16px on mobile; bumped to 16px below the `md` breakpoint,
   desktop sizing unchanged.
4. **Sidebar nav as a full-width banner.** Now that the footer bar is gone, `SidebarSwitcher`
   (Threads/Todos/Bin/Settings) becomes a full-width row on mobile and stays full-width inside the
   sidebar on desktop, instead of a small centered pill.

### V1.6 round 2 (desktop QA)

Done: icon-only nav with titles; "+" new thread moved to bottom-center of the Threadz tab; resolved
filter removed from Threadz (closed-todo filter is now a dropdown in Todos); "Copy here" renamed
"Clone from here" (branch icon) and a plain "Copy" added to the message menu; composer actions back in
a side rail (send at the bottom); top line removed (it was the Local-mode indicator bar in `App.tsx`).
The per-row "Mark resolved" toggle, its badge and the resolved filter plumbing were removed too.

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

# AGENTS.md

## What this is

Threadz — personal-brain POC. Read `docs/direction.md` (the data model, sync protocol and lenses
this rebuild is built from), `README.md` (API, sync, storage, photos, load-bearing decisions) and
`backlog.md` (open questions) before changing behavior.

## Mental model

- **One normalized model, two databases, one sync protocol.** `core/schema.ts` defines a single
  schema — `entities`, `note_versions`, `threads`, `messages`, `thread_order`, `links`,
  `property_sets`, `property_values`, `todos` — that runs unchanged on main (`bun:sqlite`,
  `backend/db.ts`) and on the phone (SQLite compiled to WASM in a Web Worker, `lib/phoneDb.ts` +
  `lib/phone/worker.ts`). `core/queries.ts` is the read side (a query per lens); `core/merge.ts` is
  the sync/merge side (`applyChanges`, `stampRevs`, `orderedMessageIds`). Both sides import the same
  `core` package — there's no separate backend model to keep in sync by hand.
- **The phone always reads and writes its own database.** There's no "live" mode that talks to main
  directly and no auto-detach — `frontend/src/lib/data.ts` is a thin facade over the phone's own
  `Driver`, and every read/write in the app goes through it. Main (`backend/server.ts`) is a pure
  sync target and the place heavy work runs (Ask). Moving data between them is **only**
  `frontend/src/lib/syncEngine.ts`'s `syncNow()`: push this device's pending rows (`rev IS NULL`),
  then pull whatever main has newer than this device's cursor. It's a button, or the same push/pull
  on a 15s timer while "keep live" is on (pauses when the tab is hidden, turns itself off after 5
  consecutive failed polls). Nothing auto-syncs or auto-switches; every row carries its own `rev`
  (main's write counter, `NULL` = not on main yet), so only diffs ever travel and a retry is
  harmless — merging is idempotent (`core/merge.ts`: immutable rows insert-if-missing, mutable rows
  last-write-wins on `updated_at`, a tombstone a newer live row outlives is undone — "content wins").
- **A feature is a query plus a view, never a new model.** `docs/direction.md`'s "Lenses" table is
  the checklist: thread view, Todos, Bin, search, references are each a `core/queries.ts` function
  (or one built from `lib/data.ts` on top of it) plus the component that renders its rows. Extend
  `core/queries.ts` before reaching for a bespoke SQL string in a feature file.

## Commands (bun only, never npm/yarn/pnpm)

| | |
|---|---|
| `bun run dev` / `dev:backend` / `dev:frontend` | run both / each side |
| `bun test` | invariant + e2e tests |
| `bun run smoke <url>` | curl e2e against a live backend |
| `bun run pages:build` / `pages:deploy` / `pages` | build the local-only PWA for `/threadz/` / trigger the manual Pages workflow / both |
| `bun run seed [--scale small\|real\|large] [--out path] [--stamp]` | deterministic sample `.sqlite` in `.seed/<scale>.sqlite` (README "Seed data") |
| `bun run clean:worktrees` | remove leftover `.claude/worktrees/agent-*` and their branches (only if clean and already in main) |
| `bun run typecheck` | both packages |
| `bun run lint` | Biome (warnings fail) + token lint |
| `bun run check` | typecheck + Biome (warnings fail) + token lint + tests = "green" |

Verify before claiming done: `bun run check`, then `bun run --cwd frontend build`.
Typecheck passing says nothing about whether the UI renders.

## Conventions

**Enforced by `bun run check`** (fix the code, don't work around it): no `any` (a `biome-ignore` with a
reason is the only exit), no `../` imports, no reaching into `features/<x>/*` except its `index.ts`, unused
imports/vars, formatting + import order, raw colours (`// threadz-allow-raw-color` for a real one-off), and
`noUncheckedIndexedAccess`.

**Guidelines** (not enforced; use judgment): file order (imports, types, exported component, its helpers in
call order, constants; in a component state, handlers, effects last); effects only for syncing with something
external, never for derived state; fetching and transforming data live in a hook or pure function, not in JSX;
extract a helper when the same code shows up a third time; delete dead code and comments that restate the code;
primary actions (send, add, create) use an icon once an established one exists for the action, not a text
label — reserve text labels for actions without an obvious icon, or where the icon alone would be ambiguous (the
Threads tab's **+ New** pill is labelled for that reason: beside the tab bar a bare `+` reads as "more").

- **UI copy: terse, icon-first, no restating what's already obvious.** A tab labelled by its own icon and
  position doesn't also need a text title (decided 2026-09-24, reversing an earlier
  set of `SidebarSwitcher` labels — the icon-over-text rule above applies to navigation, not just actions). A
  device-only settings panel doesn't need a subtitle saying so; nothing else in this app implies otherwise. A
  hint/description earns its place only if it says something the label genuinely doesn't (Settings' naming
  toggle's hint, "a title you typed is never replaced," is the bar — a real behavior the label can't carry;
  "leave blank to auto-detect" restating the placeholder is not). **"Main" is backend jargon — never show it to
  the user.** `StatusPill`/`syncEngine.ts`'s four states (docs/direction.md "B9") show as **Synced** (nothing
  pending, keep-live off), **Keep-live** (the 15s auto-sync loop is on), **Pending** (N changes saved on this
  device, not yet sent) and **Unreachable** (the last sync attempt failed) — never "main is reachable" or "can't
  reach main." Keep "main" itself for internal code/comments/docs (this file, README, `lib/syncEngine.ts`) — it's
  accurate shorthand for engineers, just not for the person using the app.

- **One tab, one job.** Threadz, Todos, Bin and Settings each own their functionality; a control
  belongs to exactly one tab (e.g. the closed-todo filter is Todos-only, the Threadz index has no
  resolved/todo filtering). A *message* can be a todo (a `/todo` line or the actions row's Todo toggle), but the index never
  behaves as a todo list.
- **Rarely-used UI is never shown up front.** Filters, sort and secondary actions live in a dropdown
  (`components/ui/select.tsx`) or an action menu (`components/ui/menu.tsx`), not as always-visible
  segmented controls.
- **One editor, one field.** Every place text is written (composer and its Ask mode, message edit, note edit)
  is `ContentField` (`features/editor/`): the one Crepe WYSIWYG editor inside one `rounded-3xl` gradient field with
  `leading` / `trailing` action slots; there is no raw-markdown textarea. Read views are `MarkdownEditor readOnly`,
  and a message can be read and edited on the same mounted instance (`MarkdownEditorHandle.enterEdit()` /
  `exitEdit()` / `isDirty()`, contract in `MarkdownEditor.tsx`): call `enterEdit()` inside the tap, since iOS only
  raises the keyboard for a focus inside the gesture. Dirty is judged against the editor's own re-serialised
  baseline (`dirty.ts`), never the stored text.
- **Composer**: editor on top, an action row under it (attach, mic, ⋯ on the left; send, a 44px round `Plus`, far
  right); from `md` the same slots are a vertical rail on the right (attach, mic, ⋯ on top; send last, at the
  bottom). Max three primary actions; extras go in the ⋯ menu. The Note/Ask toggle and "Keep exchange" chip sit
  above the field, only when Ask is offered. It lives at the *end of the message scroller*: focused it
  pins to the bottom (`:focus-within` — never React state, a focused Send that turns `disabled` fires no blur),
  unfocused it scrolls away with the messages; from `md` it's always pinned.
- **Mobile is the primary target.** Nav is a bottom tab bar, icon-only with a `title`. Touch targets are 44px
  below `md` (compact from `md` up — `Button`'s sizes, `size-11 md:size-9` icon buttons, `md:` variants; icons `size-5 md:size-4`). Keyboard hints ("press n", `( / )`)
  are gated on `isTouch()` (`lib/dom.ts`). Slash commands are a bare `/` (`/todo`, `/todos`); `@/` still
  parses. The selected message (and only it) gets one 44px actions row under it: date, sync/voice/edited on the left;
  Edit, Add note (only with no note yet), Todo (`aria-pressed`) and ⋯ (Copy, Copy link, Clone from here) on the
  right. A message shows a note *chip* (first line of the note) only when it has a note; it opens the note overlay.
- **The keyboard and the viewport** (`lib/viewport.ts`, `App.tsx`'s `Shell`): iOS overlays the keyboard and
  pans the visual viewport instead of resizing the layout viewport, so the shell is `position: fixed`, sized
  and offset from `visualViewport` (`--vv-h`, `--vv-top`) — never `h-dvh`, and size anything meant to fit
  "the visible area" from `--vv-h`, not `dvh`. `html[data-keyboard]` is set while the keyboard is up (drop
  home-indicator padding, shrink the editor). Never `scrollIntoView` inside the thread (it scrolls the visual
  viewport too): set the scroller's `scrollTop`. Grid tracks are `minmax(0,1fr)`, never `auto` (a nowrap
  title widens an auto track past the screen).
- `export const` arrow functions. PascalCase component files, camelCase modules.
- Layout: `components/ui/` primitives · `features/<name>/` (other features import only its `index.ts`) · `lib/`.
  `@/` across folders, `./` within one. See README "Structure & conventions".
- Semantic color tokens only in components — never a hardcoded color.
- **Menus, popovers, dropdowns, dialogs: a real primitives library, never hand-rolled.** `components/ui/menu.tsx`
  wraps `@radix-ui/react-dropdown-menu`; a message's note (`NoteSurface.tsx`, opened from `EntryRow.tsx`) is a `ResponsiveOverlay` (Radix popover / dialog) —
  positioning (flip/shift to stay on screen, `--radix-popover-content-available-width` for a max-width that can
  never overflow), the portal, outside-click, Escape and focus management are Radix's, not ours. A hand-rolled
  popover (custom `getBoundingClientRect` flip math, manual outside-click/focus-trap listeners) lived here before
  and broke twice in one week (open wouldn't fit the viewport, then a later change made it not open at all).
  Reach for the matching `@radix-ui/react-*` primitive first for anything popover/menu/dialog-shaped; write the
  positioning/focus/dismissal logic yourself only if no primitive fits. (The native `<dialog>` in
  `ConnectionDialog` and the native `<select>` in `components/ui/select.tsx` are the platform already covering
  this — leave those as they are, no library needed.)
- **`html`/`body` never scroll** (`styles.css`: `overflow: hidden`, and `body` is `position: fixed` — iOS
  rubber-bands an overflow-hidden root otherwise). Every scrollable region is its own
  `overflow-y-auto` element (`ThreadView`'s message list, `ThreadList`'s index) — the page itself doesn't, on
  purpose: it stops a too-wide child from becoming a horizontal scrollbar instead of just clipping, and it stops
  iOS from scrolling the whole page to "reveal" a focused input when nothing actually needs scrolling (which
  otherwise leaves dead space the size of the keyboard under whatever you were looking at).
- **A long message list is virtualized** (`ThreadView.tsx`, `@tanstack/react-virtual`) — each entry is its own
  lazy-loaded Milkdown editor, not cheap to all mount at once. Rows are measured (`measureElement`), not a fixed
  guess, since edit mode, an image, or a note popover all change a row's real height. Follow the same "measure,
  don't guess" pattern for any other list that can get long instead of a fixed row-height virtualizer.
- **Shortcuts and layers.** An open Radix layer (menu, popover, dialog) blocks bare-key shortcuts
  (`lib/dom.ts`'s `shortcutBlocked`; Esc-closes-thread listens in the capture phase so it sees the layer before
  Radix removes it); `chordBlocked` is the ⌘/Ctrl variant, which only stands down for a layer (⌘K works while the
  composer is focused). `.ProseMirror` overflow is visible by default; todo checkboxes live *inside* their row (`p.threadz-todo-line` /
  `/todos` items reserve left padding and a 44px hit box), never in the message gutter; only a height-capped field (`.threadz-md-scroll`, set by `ContentField`) scrolls. The thread list re-pins to the newest end while you're at the bottom
  (`following` ref), since row heights settle after their lazy editors mount; only a user gesture (wheel, touch, key,
  pointer: `userScrolled`) can end following — the virtualizer moves `scrollTop` itself while it measures. iOS raises
  the keyboard only for a focus() inside the tap: `lib/keyboard.ts`'s `holdKeyboard()` (a throwaway focused input) bridges
  taps whose real field mounts a beat later (note editor in a sheet); `enterEdit()` uses it too. Editing a row scrolls
  it into view with `revealInScroller` (`scrollTop`, never `scrollIntoView`).
- **References** (`lib/references.ts` is the pure core; `features/editor/` wires it into the editor): the stored
  grammar is `tz:<kind>/<id>@<version>` (docs/direction.md "C14"; `kind` is `thread` or `message`, `message`'s
  `id` carries `<threadId>/<from>..<to>`, `@<version>` is omitted for a live/unpinned reference — nothing pins
  one yet). It is **not** a real `href`: Milkdown's link mark runs every href through `sanitizeLinkHref` (an XSS
  allow-list of http/https/mailto/tel/ftp) and would blank a literal `tz:…` to `""`, so `MarkdownEditor.tsx`
  overrides the link mark's schema via Milkdown's public extension API (`commonmark.linkSchema.extendSchema`,
  the mark equivalent of `imageView.ts`'s node-view override below) — a `tz:` mark renders as
  `<a data-ref="tz:…">` with no `href` attribute at all, so the sanitizer never touches it and the browser can
  never navigate away by accident; any other href (a plain `https://` link) falls through to the default
  `toDOM` unchanged. Click handling reads `data-ref`, not `href`. `MarkdownEditor`
  drives the `nextAutocompleteState` machine off `referencePlugin`. Its offsets are into the *rendered*
  block text (a link's markdown length isn't in it), so after completing a link re-anchor with `continueAfterLink`
  rather than trusting `linkEnd`, and clear stored marks so typing after a link doesn't extend it. A ranged link's
  `from..to` travels as one opaque string through `?msg=`/`openThreadAt`; `resolveMessageRange` resolves it against
  the *displayed* order. The arrival jump (`ThreadView`) re-aims a few times because rows grow as their lazy editors
  mount.
- **Custom rendering inside the Milkdown view** (`features/editor/MarkdownEditor.tsx`): every `@milkdown/*`
  and `prosemirror-*` module is loaded with a dynamic `import()` inside the mount effect, never a static
  top-level import — that keeps ProseMirror out of the static import graph (and so out of `bun test`/typecheck
  and the initial bundle; `vite build` warns if something breaks this). A node view for an existing markdown
  construct (`![]()` images) is `imageView.ts` — a plain function returning `{ dom, destroy }`, registered with
  `utils.$view(schema.node, () => view)`. Decorating something that *isn't* real markdown (`/todo` lines —
  they're a plain-text convention, not an AST node) is `todoDecoration.ts` — a `prosemirror-state` `Plugin`
  returning widget/node `Decoration`s, registered with `utils.$prose(() => plugin(...))` (it also tags `/todos` items
  `threadz-todo-item`, which hides Crepe's own bullet/box read-only so each item has exactly one box). Either way, only
  type-only imports (`import type … from "@milkdown/kit/prose/*"`) belong at a helper file's top level; the
  real `Plugin`/`PluginKey`/`Decoration`/`DecorationSet`/etc. classes are handed in as arguments from
  `MarkdownEditor.tsx`'s already-dynamically-loaded modules, not imported fresh in the helper.
- **Motion** (`motion/react`; `LazyMotion`/`domAnimation` wraps the app once in `App.tsx`, components use the
  lean `m` component, not `motion`) is the app's animation library — the only case plain CSS transitions can't
  cover is an element actually leaving the tree (`AnimatePresence`: a new message's entrance, the voice-recovery
  banner, the scratch-answer dismiss — see `ThreadView.tsx`/`Composer.tsx`). Reach for it only there; hover
  states, color/opacity and similar stay plain CSS transitions. Don't add a second animation library on top of
  it, and don't reach for it to animate a Radix primitive's open/close — that's a separate integration
  (`forceMount` + `AnimatePresence`) with its own failure modes. Menus and popovers get an *enter*-only CSS
  keyframe (`pop-in`, on the Radix content) and close instantly; sheets get enter and exit keyframes on
  `data-state` (Radix Presence's documented path). Everything tappable uses the `press` family in `styles.css`
  (`press` pills scale .97, `press-icon` .9, `press-row` tints and never scales; override with `[--press-scale:…]`),
  `Button` is a full-round pill (`bg-primary-sheen` primary), floating chrome is `surface-float`, cards
  `surface-sheen`. A one-off gradient uses `color-mix` on tokens, never a literal colour.
- **Overlays**: `Menu` (anchored ⋯ actions, `side`, per-item `keepFocus`), `ResponsiveOverlay` (Radix Popover from
  768px, bottom `Sheet` below — same children; its `anchor` is the trigger; `anchorTo` opens the popover against another element) and `Sheet` (Radix Dialog, sits on the
  visual viewport so it clears the iOS keyboard) live in `components/ui/`; `lib/useMedia.ts` is the media hook.
  Toasts drop from the top on a phone (bottom-right from `md`). **Peek** (`features/threads/Peek.tsx`) is a
  `ResponsiveOverlay` that can open another `ResponsiveOverlay` from inside itself — nesting is expected, not a
  bug to route around.
- **`Chip`** (`components/ui/Chip.tsx`) is the one primitive for a value/link/todo/version marker: a `colorSlot`
  (1–8, palette tokens — never a hex literal) plus an icon and/or text as a second cue. It is dumb —
  `onClick` (optional; omit it for a static, non-interactive chip) is the caller's to define, never built into
  `Chip` itself. Property sets (`core/schema.ts`'s `property_sets`/`property_values`, any entity as
  `target_id`) are the one typed-value primitive behind it, behind "attached" (note-on-message), "local-only"
  (Ask-disabling flag on a thread), and a link's type; built-in sets have fixed ids on `core.BUILTIN`. Reach for
  a property set before inventing a new column for "one more typed thing on an entity."
- `frontend/src/lib/**` holds the sync, merge and image logic the rules below depend on: change it with care.
- All Claude calls go through `askModel()` in `backend/model.ts` (via the Claude Code
  SDK / local CLI auth — no API key). Nowhere else. It runs Claude with no tools, no MCP servers and an empty
  working directory: the model sees only the thread text it is sent, never the device's files. Ask itself
  (`lib/syncEngine.ts`'s `ask()`) is push → `POST /api/ask` → main writes the question and the answer as notes →
  pull; it's disabled while the last sync attempt failed (`unreachable`), never queued for later.
- **Insight, Home, map:** `core/insights.ts` (pure, deterministic, every result has a `source` lens+filter) and
  `core/map.ts` (`mapTracks`, `MapFilter` ⇄ `/map?` params) are queries; `features/home` and `features/map` are their
  views. Map presets and the last route are device-only (localStorage), never synced. `derived_*` tables are still
  spec-only.
- **Sync** (`lib/syncEngine.ts`, `lib/phoneDb.ts`, `lib/phone/{worker,driver,broker,protocol}.ts`): see "Mental
  model" above for the push/pull/keep-live shape. The phone's database lives in IndexedDB via
  `@subframe7536/sqlite-wasm` (`IDBBatchAtomicVFS`, FTS5 + trigram compiled in), opened inside a dedicated Web
  Worker so the wasm never loads into the main bundle or a `bun test` process — `lib/data.ts`/`lib/images.ts`
  call `openPhoneDb()` lazily, never at module top level, and a test that mounts `MarkdownEditor` (which calls
  `housekeeping()` on mount) mocks `@/lib/images`' `housekeeping` rather than let a real Worker spin up under
  happy-dom (see `editInPlace.test.tsx`/`todoDecoration.test.tsx`/`references.e2e.test.tsx`). Export/Import
  (`DataSection.tsx`) is the phone's whole `.sqlite` file (`phoneDb.dump()`/`exportFile()`), not a JSON snapshot;
  import merges a file's rows in with the same rules a sync push uses. A delete keeps a copy in the device's Bin
  (`core.bin`: entities with `deleted_at` set) — main keeps deleted rows too (tombstones, never a hard delete),
  so restoring and re-syncing just clears the flag on both sides.
- **Images** (`lib/images.ts`, `imageSync.ts`; `backend/images.ts`): a note holds only `![](img:<sha256>#WxH)`.
  Bytes live in their own IndexedDB (`threadz-images`) and, on main, as files in `THREADZ_IMAGES` — never in a
  `.sqlite` export/import, never in `core`'s synced tables, `backupDb()` or the sync push/pull payload. A `dirty`
  image is never deleted; it is `PUT` to main before a sync push.
- **Appearance** (`themes/*.css`, `themes/palettes.ts`, `features/appearance/`, `features/settings/sections/`
  Appearance + Background): light vs dark is **only** the Light/System/Dark toggle (`ThemeToggle`,
  `window._setTheme`); a **palette** (`data-palette` on `<html>`, `window._setPalette`) is a colour *family*
  that ships both modes — the base block of its CSS file is light, `.dark` / `.system` are dark. Both are
  pre-paint single-writer scripts in `index.html`, so no flash. Six families: `gruvbox`, `one`, `everforest`,
  `solarized`, `catppuccin`, `nord` (default `gruvbox`); always-dark identities with no honest light variant
  (Dracula, Monokai…) were dropped rather than pretend, and old stored ids are migrated in `index.html`. Every
  palette defines the exact same token set (copy `gruvbox.css` for a new one) — components never know which is
  active. The picker is a grid of six round swatches (no names; a 1px inset `--border` ring, selected = `outline`, a soft
  oklab band, never a border or a scale), previewing the mode currently in effect.
  The **background** is one more device-local setting (`lib/settings.ts`'s `background`; image bytes in
  `lib/backgroundImage.ts`'s own IndexedDB, never in a snapshot/backup): the default is a faint token-built
  gradient (`gradients.ts`), or the user's image — picked and **Remove**d in Settings (removing returns to the
  default; there is no "none"). Rendered once, behind everything (`BackgroundLayer.tsx`). How much of an image
  shows is the panes' opacity, not the image's: panes use `surface-background/-secondary/-card`
  (`styles.css`) over `--pane-alpha`, which `lib/settings.ts` derives from the slider (92% without an image,
  falling as opacity rises; default 80%). Big persistent panes get that alpha only, no blur (cheap); small
  floating chrome (popover, dropdown, toast, sheet) is `surface-float` (fixed 96% gradient + blur).
- Request bodies are validated with Zod schemas in `backend/schemas.ts`; a bad body is a 400, never a 500.
- **Generated metadata/embeddings/"related threads" don't exist right now.** `core/schema.ts`'s `threads` table
  has no description/tags/embedding columns; the v1 generation pipeline and its endpoints were dropped when main
  moved onto `core/` (`backlog.md`), with no code kept for it.
- Tests cover logic with branching and the sync/merge/image rules, plus one HTTP round-trip that cleans up after
  itself. No per-component suites — the few component tests (`EntryRow`, `todoDecoration`, references e2e) each pin
  one wiring regression; a change that touches none of that needs no new test.

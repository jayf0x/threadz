# AGENTS.md

## What this is

Threadz — personal-brain POC. Read `README.md` (API, local mode, photos, load-bearing decisions) and
`backlog.md` (open questions) before changing behavior.

## Mental model

- One backend, one SQLite file, many devices. The frontend keeps a **disposable** mirror of main
  (`threadz` IndexedDB, wholesale-replaced on fetch) and a **durable** device copy (`threadz-local`,
  see Local mode below).
- The backend stores plain threads and messages; nothing in the schema depends on where a note came from.

## Commands (bun only, never npm/yarn/pnpm)

| | |
|---|---|
| `bun run dev` / `dev:backend` / `dev:frontend` | run both / each side |
| `bun test` | invariant + e2e tests |
| `bun run smoke <url>` | curl e2e against a live backend |
| `bun run pages:build` / `pages:deploy` / `pages` | build the local-only PWA for `/threadz/` / trigger the manual Pages workflow / both |
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
  the user.** The user-facing pair is **Local** (this device, works offline — already `getMode() === "local"`
  internally) and **Live** (backend reachable — already `"live"` internally); a status/dialog says "Local" /
  "Live" / "Offline" (already `StatusPill`'s three states), never "main is reachable" or "can't reach main."
  Keep "main" itself for internal code/comments/docs (this file, README, `lib/mode.ts`) — it's accurate
  shorthand for engineers, just not for the person using the app.

- **One tab, one job.** Threadz, Todos, Bin and Settings each own their functionality; a control
  belongs to exactly one tab (e.g. the closed-todo filter is Todos-only, the Threadz index has no
  resolved/todo filtering). A *message* can be a todo (a `/todo` line or the ⋯ menu's Todo toggle), but the index never
  behaves as a todo list.
- **Rarely-used UI is never shown up front.** Filters, sort and secondary actions live in a dropdown
  (`components/ui/select.tsx`) or an action menu (`components/ui/menu.tsx`), not as always-visible
  segmented controls.
- **Composer**: editor on the left, an action rail on the right (attach, mic, ⋯ overflow on top; send always
  last, at the bottom — a 2×2 on phones so the composer isn't taller than its text, a column from `md`). Max
  three primary actions; extras go in the ⋯ menu. It lives at the *end of the message scroller*: focused it
  pins to the bottom (`:focus-within` — never React state, a focused Send that turns `disabled` fires no blur),
  unfocused it scrolls away with the messages; from `md` it's always pinned.
- **Mobile is the primary target.** Nav is a bottom tab bar, icon-only with a `title`. Touch targets are 40px
  below `md` (compact from `md` up — `Button`'s sizes, `tap` in `ThreadView.tsx`, `md:` variants). Keyboard hints ("press n", `( / )`)
  are gated on `isTouch()` (`lib/dom.ts`). Slash commands are a bare `/` (`/todo`, `/todos`); `@/` still
  parses. Per-message metadata (date, sync/voice/edited, ⋯) shows only on the selected message. A message
  shows a note icon only when it has a note; "Add note" is in its ⋯ menu.
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
  wraps `@radix-ui/react-dropdown-menu`; a message's note (`ThreadView.tsx`) is `@radix-ui/react-popover` directly —
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
  composer is focused). `.ProseMirror` overflow is visible by default (a gutter checkbox at `left:-20px` is clipped
  otherwise); only `.composer-editor` scrolls. The thread list re-pins to the newest end while you're at the bottom
  (`following` ref), since row heights settle after their lazy editors mount.
- **References** (`lib/references.ts` is the pure core; `features/editor/` wires it into both editors): both adapters
  drive the one `nextAutocompleteState` machine. In the Crepe (WYSIWYG) editor its offsets are into the *rendered*
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
  returning widget/node `Decoration`s, registered with `utils.$prose(() => plugin(...))`. Either way, only
  type-only imports (`import type … from "@milkdown/kit/prose/*"`) belong at a helper file's top level; the
  real `Plugin`/`PluginKey`/`Decoration`/`DecorationSet`/etc. classes are handed in as arguments from
  `MarkdownEditor.tsx`'s already-dynamically-loaded modules, not imported fresh in the helper.
- **Motion** (`motion/react`; `LazyMotion`/`domAnimation` wraps the app once in `App.tsx`, components use the
  lean `m` component, not `motion`) is the app's animation library — the only case plain CSS transitions can't
  cover is an element actually leaving the tree (`AnimatePresence`: a new message's entrance, the voice-recovery
  banner, the scratch-answer dismiss — see `ThreadView.tsx`/`Composer.tsx`). Reach for it only there; hover
  states, color/opacity and similar stay plain CSS transitions. Don't add a second animation library on top of
  it, and don't reach for it to animate a Radix primitive's open/close — that's a separate integration
  (`forceMount` + `AnimatePresence`) with its own failure modes; the current menus ship with Radix's instant
  default rather than take that on for a small action list.
- `frontend/src/lib/**` holds the sync, merge and image logic the rules below depend on: change it with care.
- All Claude calls go through `askModel()` in `backend/model.ts` (via the Claude Code
  SDK / local CLI auth — no API key). Nowhere else. It runs Claude with no tools, no MCP servers and an empty
  working directory: the model sees only the thread text it is sent, never the device's files.
- **Local mode** (`lib/local.ts`, `replica.ts`, `handoff.ts`, `mode.ts`, `status.ts`): `threadz-local`
  is the device's authoritative copy of main. While live it is kept warm by `pullMain()` (hash
  compare vs `base`, fetch changed threads, union); `api.ts` `via()` auto-detaches to it when main is
  truly unreachable. Never clear it wholesale, never auto-switch back to live, and move data only
  through `handoff.syncNow()` (pull → one `/api/sync` push → verify → compare hashes). Merges are
  unions by message id; delete-vs-edit is "content wins". The `threadz` mirror stays disposable. A delete keeps
  a copy in the device's `trash` (the Bin tab; `handoff.restoreThread`) — main keeps none, so a live restore
  re-sends the thread through `syncNow`.
  Keep `remoteApi` and `localApi` signature-identical. Local mode offers no Ask (Claude lives on main). A
  legacy `outbox` IndexedDB store is drained once into the device copy by `replica.ts`; nothing writes it.
- **Images** (`lib/images.ts`, `imageSync.ts`; `backend/images.ts`): a note holds only `![](img:<sha256>#WxH)`.
  Bytes live in their own IndexedDB (`threadz-images`) and, on main, as files in `THREADZ_IMAGES` — never in
  `exportSnapshot`/`saveBackup`/`mergeSnapshot`/Export, never in SQLite, `backupDb()` or `/api/snapshot`. A `dirty`
  image is never deleted; it is `PUT` to main before `/api/sync`.
- **Appearance** (`themes/*.css`, `themes/palettes.ts`, `features/appearance/`, `features/settings/sections/`
  Appearance + Background): light vs dark is **only** the Light/System/Dark toggle (`ThemeToggle`,
  `window._setTheme`); a **palette** (`data-palette` on `<html>`, `window._setPalette`) is a colour *family*
  that ships both modes — the base block of its CSS file is light, `.dark` / `.system` are dark. Both are
  pre-paint single-writer scripts in `index.html`, so no flash. Six families: `gruvbox`, `one`, `everforest`,
  `solarized`, `catppuccin`, `nord` (default `gruvbox`); always-dark identities with no honest light variant
  (Dracula, Monokai…) were dropped rather than pretend, and old stored ids are migrated in `index.html`. Every
  palette defines the exact same token set (copy `gruvbox.css` for a new one) — components never know which is
  active. The picker shows a bordered dot per family (no names), previewing the mode currently in effect.
  The **background** is one more device-local setting (`lib/settings.ts`'s `background`; image bytes in
  `lib/backgroundImage.ts`'s own IndexedDB, never in a snapshot/backup): the default is a faint token-built
  gradient (`gradients.ts`), or the user's image — picked and **Remove**d in Settings (removing returns to the
  default; there is no "none"). Rendered once, behind everything (`BackgroundLayer.tsx`). How much of an image
  shows is the panes' opacity, not the image's: panes use `surface-background/-secondary/-card`
  (`styles.css`) over `--pane-alpha`, which `lib/settings.ts` derives from the slider (92% without an image,
  falling as opacity rises; default 80%). Big persistent panes get that alpha only, no blur (cheap); small
  floating chrome (popover, dropdown) additionally gets `backdrop-blur-md`.
- "Related threads" (`/api/threads/:id/related`) is a v2 endpoint and not in the UI; see `backlog.md`.
- Request bodies are validated with Zod schemas in `backend/schemas.ts`; a bad body is a 400, never a 500.
- Metadata generation is fire-and-forget after each append (no queue) — off by default; set `THREADZ_METADATA=1`
  to turn it on (v1 dropped generated description/tags/embeddings/related from the UI; the code stays for v2).
- Tests cover logic with branching and the sync/merge/image rules, plus one HTTP round-trip that cleans up after
  itself. No per-component suites — the few component tests (`EntryRow`, `todoDecoration`, references e2e) each pin
  one wiring regression; a change that touches none of that needs no new test.

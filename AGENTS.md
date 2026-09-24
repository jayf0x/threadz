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
| `bun run dev:backend` / `dev:frontend` | run each side |
| `bun test` | invariant + e2e tests |
| `bun run smoke <url>` | curl e2e against a live backend |
| `bun run pages:build` / `pages:deploy` | build the local-only PWA for `/threadz/` / trigger the manual Pages workflow |
| `bun run typecheck` | both packages |
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
label — reserve text labels for actions without an obvious icon, or where the icon alone would be ambiguous.

- **UI copy: terse, icon-first, no restating what's already obvious.** A tab labelled by its own icon and
  position doesn't also need a text title (decided 2026-09-24, reversing this session's earlier
  `SidebarSwitcher` labels — the icon-over-text rule above applies to navigation, not just actions). A
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
  resolved/todo filtering). A thread *can* be a todo, but the index never behaves as a todo list.
- **Rarely-used UI is never shown up front.** Filters, sort and secondary actions live in a dropdown
  (`components/ui/select.tsx`) or an action menu (`components/ui/menu.tsx`), not as always-visible
  segmented controls. Nav is icon-only with a `title`.
- **Composer**: editor on the left, a vertical action rail on the right (attach, mic, ⋯ overflow on
  top; send always at the bottom). Max three primary actions; extras go in the ⋯ menu.
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
- **`html`/`body` never scroll** (`styles.css`: `overflow: hidden`). Every scrollable region is its own
  `overflow-y-auto` element (`ThreadView`'s message list, `ThreadList`'s index) — the page itself doesn't, on
  purpose: it stops a too-wide child from becoming a horizontal scrollbar instead of just clipping, and it stops
  iOS from scrolling the whole page to "reveal" a focused input when nothing actually needs scrolling (which
  otherwise leaves dead space the size of the keyboard under whatever you were looking at).
- **A long message list is virtualized** (`ThreadView.tsx`, `@tanstack/react-virtual`) — each entry is its own
  lazy-loaded Milkdown editor, not cheap to all mount at once. Rows are measured (`measureElement`), not a fixed
  guess, since edit mode, an image, or a note popover all change a row's real height. Follow the same "measure,
  don't guess" pattern for any other list that can get long instead of a fixed row-height virtualizer.
- **Custom rendering inside the Milkdown view** (`features/editor/MarkdownEditor.tsx`): every `@milkdown/*`
  and `prosemirror-*` module is loaded with a dynamic `import()` inside the mount effect, never a static
  top-level import — that keeps ProseMirror out of the static import graph (and so out of `bun test`/typecheck
  and the initial bundle; `vite build` warns if something breaks this). A node view for an existing markdown
  construct (`![]()` images) is `imageView.ts` — a plain function returning `{ dom, destroy }`, registered with
  `utils.$view(schema.node, () => view)`. Decorating something that *isn't* real markdown (`@/todo` lines —
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
  unions by message id; delete-vs-edit is "content wins". The `threadz` mirror stays disposable.
  Keep `remoteApi` and `localApi` signature-identical. Local mode offers no Ask (Claude lives on main). A
  legacy `outbox` IndexedDB store is drained once into the device copy by `replica.ts`; nothing writes it.
- **Images** (`lib/images.ts`, `imageSync.ts`; `backend/images.ts`): a note holds only `![](img:<sha256>#WxH)`.
  Bytes live in their own IndexedDB (`threadz-images`) and, on main, as files in `THREADZ_IMAGES` — never in
  `exportSnapshot`/`saveBackup`/`mergeSnapshot`/Export, never in SQLite, `backupDb()` or `/api/snapshot`. A `dirty`
  image is never deleted; it is `PUT` to main before `/api/sync`.
- **Appearance** (`themes/*.css`, `themes/palettes.ts`, `features/appearance/`, `features/settings/sections/`
  Appearance + Background): a **palette** (color values, picked in Settings, applied via `data-palette` on
  `<html>`, `window._setPalette`) is a separate axis from **theme** (light/dark/system, `ThemeToggle`,
  `window._setTheme`) — both are pre-paint single-writer scripts in `index.html`, same pattern, so there's no
  flash on load either way. Palette names are recognizable dev-culture/editor-terminal names, not poetic ones —
  12 of them: `gruvbox-light`/`gruvbox-dark`, `one-light`/`one-dark`, `everforest`, `solarized-light`,
  `night-owl`, `dracula`, `nord`, `ubuntu`, `monokai`, `catppuccin` (`themes/palettes.ts`'s `PALETTES`, default
  `gruvbox-light`). A light-identity palette's `.dark`/`.system` blocks render that family's real dark
  counterpart where one exists (`gruvbox-dark`, `one-dark`, or an unlisted-but-real Everforest/Solarized dark
  variant); an always-dark-identity palette (night-owl, dracula, nord, ubuntu, monokai, catppuccin,
  gruvbox-dark, one-dark) renders the same look in all three blocks — forcing "light" on Dracula still shows
  Dracula. Every palette defines the exact same token set as `gruvbox-light.css` (copy its shape for a new
  one) — components never know which palette is active, only the token names. The **background** (image/GIF,
  or the one built-in token-built gradient, plus opacity) is one more device-local setting (`lib/settings.ts`'s
  `background` field) with its own IndexedDB for the image bytes (`lib/backgroundImage.ts`, `threadz-background`
  — same reasoning as Images below: too big for localStorage, never in a snapshot/backup). A fresh install
  defaults to `{ type: "gradient", opacity: 10 }` — a subtle ambient wash (`features/appearance/gradients.ts`'s
  `DEFAULT_BACKGROUND_GRADIENT`, an accent→secondary blend) shown at low opacity out of the box, not a flat
  background. `"gradient"` isn't a choice in Settings' Background section though (a per-preset gradient picker
  didn't read well) — only **None** (explicit opt-out, flat) and **Image** (the user's own wallpaper) are;
  picking either is one-directional, there's no UI path back to the default gradient. It's rendered once,
  behind everything (`features/appearance/BackgroundLayer.tsx`, `App.tsx`), and — being pure device state — is
  already identical in Local and Live without either mode knowing it exists. For a surface to let it show
  through: a big persistent pane (sidebar, main, the composer bar) gets `bg-<token>/NN` opacity only, no blur
  (cheap, and correct against a static layer); a small *floating* piece of chrome (a popover, a dropdown menu)
  additionally gets `backdrop-blur-md` — reserve blur for that transient-overlay case, not for large always-on
  surfaces (rendering cost, and Wigl — this pattern's source — draws the same line).
- "Related threads" (`/api/threads/:id/related`) is a v2 endpoint and not in the UI; see `backlog.md`.
- Request bodies are validated with Zod schemas in `backend/schemas.ts`; a bad body is a 400, never a 500.
- Metadata generation is fire-and-forget after each append (no queue) — off by default; set `THREADZ_METADATA=1`
  to turn it on (v1 dropped generated description/tags/embeddings/related from the UI; the code stays for v2).
- Tests cover logic with branching and the sync/merge/image rules, plus one HTTP round-trip that cleans up after
  itself. No per-component suites; a change that touches none of that needs no new test.

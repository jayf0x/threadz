// The one WYSIWYG markdown editor — Milkdown's Crepe behind a controlled React wrapper. Every
// editable surface renders it through `ContentField` (composer, message edit, note edit); the read
// views render it `readOnly`. The libs are dynamic `import()`s inside the mount effect, so ProseMirror
// stays in its own lazy chunk and never runs outside a browser (bun test, typecheck).
//
// CrepeBuilder, not the `Crepe` umbrella: the umbrella statically pulls every
// feature (katex, codemirror language-data, dompurify, …) whether enabled or
// not. The builder pulls only what's added — here `list-item` + `placeholder`.
// The `cursor` feature stays off: it layers a fake caret on the native one and
// ghosts a duplicate, worst inside code blocks; `caret-color` in the
// stylesheet keeps the native caret visible instead.

// Type-only: erased at compile time, so the document-touching runtime modules
// stay out of the static import graph.
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { housekeeping } from "@/lib/images";
import {
  buildReferenceHref,
  completeMessage,
  completeThread,
  messageRangeParam,
  nextAutocompleteState,
  parseReferenceHref,
  type ReferenceAutocompleteState,
} from "@/lib/references";
import { padForInsert } from "@/lib/voice/text";
import { isDirty } from "./dirty";
import { imageView } from "./imageView";
import { ReferenceAutocompleteMenu } from "./ReferenceAutocompleteMenu";
import { handleReferenceKeyDown } from "./referenceKeyboard";
import { referencePlugin } from "./referencePlugin";
import { todoDecorationPlugin } from "./todoDecoration";
import { useReferenceAutocomplete } from "./useReferenceAutocomplete";
import "./markdown-editor.css";

/** The handle contract, for callers that mount one `MarkdownEditor`/`ContentField` and flip it
 * between reading and editing (a message row: same instance, no remount, so the keyboard comes up
 * from the tap itself and nothing shifts).
 *
 *  - Tap on Edit -> call `enterEdit()` synchronously inside that handler (iOS raises the keyboard
 *    only for a `focus()` that runs inside the user gesture), then set your own `editing` state and
 *    pass `readOnly={!editing}`. `enterEdit` makes the view editable, focuses it with the caret at
 *    the end and snapshots the baseline (see `isDirty`).
 *  - `onDirtyChange(dirty)` reports (debounced ~200ms, and only on change) whether the text now
 *    differs from that baseline; `isDirty()` answers immediately. Never compare `getMarkdown()`
 *    against the stored message text yourself: Milkdown re-serialises (`* a` -> `- a`,
 *    `snake_case` -> `snake\_case`), so an untouched old message would look edited.
 *  - Save: `if (isDirty()) persist(getMarkdown())`, then `exitEdit()`. Cancel/Esc: `exitEdit(true)`
 *    puts the last `value` prop back and leaves silently, without a history entry.
 *  - `exitEdit` makes the view read-only again and blurs it (keyboard down). */
export type MarkdownEditorHandle = {
  /** The markdown right now. `onChange` is debounced (~200ms), so a submit handler
   * that fires straight after typing must read this instead of its last value. */
  getMarkdown: () => string;
  /** Replace the content now. Needed after a submit: the debounced `onChange` may not have
   * caught up, so `value` can already equal the new text and never re-sync on its own. */
  setMarkdown: (markdown: string) => void;
  /** Insert `text` at the caret (after any selection) with just the spaces it needs, leaving
   * the caret after it and focus alone — so dictation works with the keyboard closed. If the
   * user never put a caret in the editor, it goes at the end. False if the editor isn't
   * loaded yet (caller should keep the text elsewhere). */
  insertAtCaret: (text: string) => boolean;
  /** Insert an image (`img:` ref or URL) at the caret, same placement rules as `insertAtCaret`. */
  insertImage: (src: string) => boolean;
  /** Focus the editor. If the user never put a caret in it, the caret goes to the end first, so a
   * dictation started from a cold editor appends to the draft instead of landing in front of it. */
  focus: () => void;
  /** Start editing in place: editable now (synchronously), focused, baseline snapshotted. Call it
   * inside the tap that starts the edit. A no-op until the editor has loaded; in that case the
   * `readOnly={false}` prop you also set takes over on load. */
  enterEdit: () => void;
  /** Stop editing: read-only again, blurred, baseline dropped. `discard` first restores the
   * current `value` prop (Cancel/Esc). */
  exitEdit: (discard?: boolean) => void;
  /** Has the text changed since editing began, judged by the editor's own normalisation. */
  isDirty: () => boolean;
};

type EditorTrLike = {
  doc: { resolve: (pos: number) => ResolvedPos };
  setSelection: (s: unknown) => unknown;
  setStoredMarks: (marks: readonly unknown[]) => unknown;
  insertText: (t: string, from: number) => EditorTrLike;
  insert: (at: number, node: unknown) => EditorTrLike;
  replaceWith: (from: number, to: number, node: unknown) => EditorTrLike;
};

// Minimal shape of the ProseMirror EditorView bits the insert helpers touch — keeps
// prose types (and their document-touching modules) out of the static graph.
type EditorViewLike = {
  state: {
    tr: {
      setSelection: (s: unknown) => unknown;
      insertText: (t: string, from: number) => EditorTrLike;
      insert: (at: number, node: unknown) => EditorTrLike;
      replaceWith: (from: number, to: number, node: unknown) => EditorTrLike;
    };
    doc: Node;
    selection: { to: number };
    // Only what `completeReference` needs to build a linked text node itself, rather than going
    // through a node-schema helper the way `insertImage` does with `commonmark.imageSchema` — a
    // mark (unlike a node) has no equivalent "create one already-linked node" shortcut.
    schema: { text: (text: string, marks?: unknown[]) => unknown };
  };
  dom: HTMLElement;
  dispatch: (tr: unknown) => void;
  focus: () => void;
};

type Loaded = {
  editor: { action: (fn: (ctx: Ctx) => void) => void };
  replaceAll: (markdown: string) => (ctx: Ctx) => void;
  insertAtCaret: (text: string, touched: boolean) => void;
  insertImage: (src: string, touched: boolean) => void;
  focus: (touched: boolean) => void;
  blur: () => void;
  setPlaceholder: (text: string) => void;
  /** Replace doc positions `[from, to)` with a single already-linked text node — how the reference
   * autocomplete (`lib/references.ts`'s `completeThread`/`completeMessage`) lands its result in the
   * live WYSIWYG view: `from`/`to` are absolute doc positions (the caller maps its own local,
   * block-relative offsets through `blockStart` first — see `referencePlugin.ts`). */
  completeReference: (from: number, to: number, text: string, href: string) => void;
};

type CrepeLike = { setReadonly: (v: boolean) => unknown; getMarkdown: () => string };

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = "",
  readOnly = false,
  handleRef,
  onKeyDownCapture,
  onImageFile,
  onTodoToggle,
  onReferenceClick,
  onDirtyChange,
  className,
  style,
  autofocus,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  /** Live: changing it updates the empty-field hint (the composer's Note/Ask). */
  placeholder?: string;
  /** Display mode: same rendering, no caret. Toggles live, on the same mounted instance. */
  readOnly?: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Capture phase — runs before ProseMirror's own handlers, so a caller can
   * claim a chord (e.g. ⌘Enter to send) with preventDefault + stopPropagation. */
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  /** Called with an image pasted or dropped into the editor (which then inserts nothing itself). */
  onImageFile?: (file: File) => void;
  /** A gutter checkbox (`/todo` line, or an item inside a `/todos` group) was clicked, naming the
   * line's index into `value.split("\n")` — the caller re-derives the toggled content via
   * `toggleTodoLine` (`lib/todos.ts`) and persists it the same way it persists any other edit. See
   * `./todoDecoration.ts` and `ThreadView.tsx`'s `EntryRow`. */
  onTodoToggle?: (lineIndex: number) => void;
  /** A rendered reference link (`[text](thread=…)`, see `lib/references.ts`) was clicked. The
   * caller navigates in-app (`App.tsx`'s `openThreadAt`), never a page reload. `messageId` is `<id>`
   * or, for a range, `<from>..<to>` (`lib/references.ts`'s `resolveMessageRange` reads it). */
  onReferenceClick?: (threadId: string, messageId: string | null) => void;
  /** Editing only: the text now differs from (or is back to) what it was when editing began. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Layout knobs are CSS vars, not props: `--md-padding` (default
   * `14px 18px 40px`) and `--md-max-height` (default none, else the editor
   * scrolls), `--md-min-height` (default 100%), `--md-img-max` (photo width, default 32rem). Set them from here, e.g. `[--md-padding:10px_12px]`. */
  className?: string;
  /** For a var that has to be a computed runtime value (a measured height), not a static
   * Tailwind arbitrary class — e.g. `{ "--md-min-height": "220px" }`. */
  style?: CSSProperties;
  /** Focus once mounted, as soon as the editor is actually ready to receive it (Crepe loads
   * async — this waits for `crepe.create()`, it doesn't race it). A mount-time flag, not a
   * live prop: re-focusing on every render would steal focus back mid-edit. On iOS this lands a
   * caret without the keyboard (no user gesture); for edit-in-place use the handle's `enterEdit`. */
  autofocus?: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Same latest-ref shape as onChangeRef: the todo-decoration plugin is only built once (the mount
  // effect below never re-runs), but the callback it should call can change across renders — a
  // stale closure here would silently call an old EntryRow's onEdit instead of the current one.
  const onTodoToggleRef = useRef(onTodoToggle);
  onTodoToggleRef.current = onTodoToggle;
  const onReferenceClickRef = useRef(onReferenceClick);
  onReferenceClickRef.current = onReferenceClick;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  // Latest markdown Crepe emitted — lets the value-sync effect skip the echo
  // of the user's own typing.
  const lastEmittedRef = useRef(value);
  // Mount-time inputs, read inside the async effect without becoming deps.
  const initial = useRef({ value, placeholder, autofocus });
  // What the props say right now, so an update that lands while Crepe is still loading isn't lost.
  const latest = useRef({ value, readOnly, placeholder });
  latest.current = { value, readOnly, placeholder };
  // Has the user ever put a caret in here? Until then a programmatic insert goes to the end
  // (ProseMirror's untouched selection sits at the very start, i.e. *before* a restored draft).
  const touchedRef = useRef(false);
  const crepeRef = useRef<CrepeLike | null>(null);
  // The text as the editor itself serialises it when editing began (null while reading) — see
  // `dirty.ts` and the handle contract above.
  const baselineRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  // The reference autocomplete's live state, reported by `referencePlugin.ts`'s `onLocalUpdate` on
  // every selection/doc change and advanced through `nextAutocompleteState` (see that file's own
  // comment for why "message" stage can't just be re-derived from arbitrary rendered text the way
  // "thread" stage is).
  // `blockStart` is what turns `state`'s local (block-relative) offsets back into real doc positions
  // for `completeReference`; bundled with `state`/`rect` so all three always describe the same update.
  const [local, setLocal] = useState<{
    state: ReferenceAutocompleteState;
    rect: { left: number; top: number; bottom: number } | null;
    blockStart: number;
  }>({ state: { stage: "closed" }, rect: null, blockStart: 0 });
  const ac = useReferenceAutocomplete(local.state);

  const setDirty = (dirty: boolean) => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  };

  const beginEditing = () => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    baselineRef.current = crepe.getMarkdown();
    setDirty(false);
  };

  const closeAutocomplete = () => setLocal((l) => ({ ...l, state: { stage: "closed" }, rect: null }));

  const acceptReference = (index: number) => {
    const opt = ac.options[index];
    const loaded = loadedRef.current;
    const st = local.state;
    if (!opt || !loaded) return;
    if (st.stage === "thread") {
      const thread = ac.findThread(opt.id);
      if (!thread) return;
      const { edit, next } = completeThread(st, thread);
      loaded.completeReference(
        local.blockStart + edit.from,
        local.blockStart + edit.to,
        thread.title,
        buildReferenceHref(thread.id),
      );
      continueAfterLink(next, thread.title);
    } else if (st.stage === "message") {
      const message = ac.findMessage(opt.id);
      if (!message) return;
      const { edit, next, href } = completeMessage(st, message);
      loaded.completeReference(local.blockStart + edit.from, local.blockStart + edit.to, st.displayText, href);
      continueAfterLink(next, st.displayText);
    }
  };

  // The state machine's `linkEnd` counts the link's MARKDOWN (`[text](href)`); this view's block text
  // holds only the display text (the href is a mark), and the caret offsets `nextAutocompleteState`
  // compares against are measured in that — so re-anchor `linkEnd` to the rendered length, or the
  // message stage closes on the very next update. The plugin's own report during
  // `completeReference`'s dispatch already saw "no trigger left" and cleared state + rect; putting
  // the continued state (and the rect it was anchored at) back is what keeps the popup open.
  const continueAfterLink = (next: ReferenceAutocompleteState, shownText: string) =>
    setLocal((l) => ({
      ...l,
      state: next.stage === "message" ? { ...next, linkEnd: next.anchor + shownText.length } : next,
      rect: next.stage === "closed" ? null : local.rect,
    }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-time only; everything read here is a ref or a stable setter.
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;
    housekeeping(); // once per page load: persistent-storage request + orphan sweep

    (async () => {
      const [
        { CrepeBuilder },
        { listItem },
        { placeholder: placeholderFeature, placeholderConfig },
        commonmark,
        core,
        state,
        proseView,
        utils,
      ] = await Promise.all([
        import("@milkdown/crepe/builder"),
        import("@milkdown/crepe/feature/list-item"),
        import("@milkdown/crepe/feature/placeholder"),
        import("@milkdown/kit/preset/commonmark"),
        import("@milkdown/kit/core"),
        import("@milkdown/kit/prose/state"),
        import("@milkdown/kit/prose/view"),
        import("@milkdown/kit/utils"),
      ]);
      if (destroyed || !containerRef.current) return;

      const { value: v, placeholder: text } = initial.current;
      const crepe = new CrepeBuilder({ root: containerRef.current, defaultValue: v })
        // Round task boxes (`- [ ]`) instead of Crepe's square ones; strokes take `currentColor`.
        .addFeature(listItem, { checkBoxUncheckedIcon: TASK_OPEN, checkBoxCheckedIcon: TASK_DONE })
        // "doc": show the placeholder only when the whole field is empty —
        // "block" re-shows it on every empty line, which reads as "my text
        // disappeared".
        .addFeature(placeholderFeature, { text, mode: "doc" });
      // Photos: `img:` refs render as lazy grey boxes (./imageView.ts).
      crepe.editor.use(utils.$view(commonmark.imageSchema.node, () => imageView));
      // `/todo`/`/todos` lines: gutter checkbox + highlight decoration, no new node type
      // (./todoDecoration.ts). `getValue`/`hasToggle`/`onToggle` all read through the latest-refs
      // above so this one-time plugin instance never acts on stale props — `hasToggle` is what
      // actually decides "render a checkbox at all" (not `onTodoToggleRef.current` being handed to
      // `onToggle` directly, which would always be a defined wrapper function even when the caller
      // never passed `onTodoToggle`).
      crepe.editor.use(
        utils.$prose(() =>
          todoDecorationPlugin(state, proseView, {
            getValue: () => latest.current.value,
            hasToggle: () => !!onTodoToggleRef.current,
            onToggle: (lineIndex) => onTodoToggleRef.current?.(lineIndex),
          }),
        ),
      );
      // References (lib/references.ts): click-to-navigate always (Crepe already renders a
      // completed `[text](thread=…)` as a plain clickable link, no new node type), plus — while
      // editable — reporting this text block's plain text/caret so React can drive the
      // trigger/two-stage-autocomplete state machine.
      crepe.editor.use(
        utils.$prose(() =>
          referencePlugin(state, {
            onLocalUpdate: (upd) => {
              setLocal((prev) => {
                const nextState = upd
                  ? nextAutocompleteState(prev.state, upd.text, upd.caret)
                  : { stage: "closed" as const };
                return {
                  state: nextState,
                  rect: nextState.stage === "closed" ? null : (upd?.rect ?? null),
                  blockStart: upd?.blockStart ?? prev.blockStart,
                };
              });
            },
          }),
        ),
      );
      crepe.on((api: { markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void }) => {
        api.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          onChangeRef.current?.(markdown);
          if (baselineRef.current !== null) setDirty(isDirty(baselineRef.current, markdown));
        });
      });

      // safe: EditorViewLike is a structural subset of ProseMirror's EditorView
      const viewOf = (ctx: Ctx) => ctx.get(core.editorViewCtx) as EditorViewLike;
      loadedRef.current = {
        editor: crepe.editor,
        replaceAll: utils.replaceAll,
        insertAtCaret: (text, touched) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = viewOf(ctx);
            const { doc } = view.state;
            const at = touched ? view.state.selection.to : state.Selection.atEnd(doc).to;
            const around = (from: number, to: number) =>
              doc.textBetween(Math.max(0, from), Math.min(doc.content.size, to), " ");
            const pad = padForInsert(around(at - 1, at), around(at, at + 1), text);
            const tr = view.state.tr.insertText(pad.text, at);
            tr.setSelection(state.Selection.near(tr.doc.resolve(at + pad.caretOffset)));
            view.dispatch(tr);
          }),
        insertImage: (src, touched) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = viewOf(ctx);
            const at = touched ? view.state.selection.to : state.Selection.atEnd(view.state.doc).to;
            const tr = view.state.tr.insert(at, commonmark.imageSchema.type(ctx).create({ src }));
            tr.setSelection(state.Selection.near(tr.doc.resolve(at + 1)));
            view.dispatch(tr);
          }),
        focus: (touched) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = viewOf(ctx);
            if (!touched) view.dispatch(view.state.tr.setSelection(state.Selection.atEnd(view.state.doc)));
            view.focus();
          }),
        blur: () => crepe.editor.action((ctx: Ctx) => viewOf(ctx).dom.blur()),
        setPlaceholder: (next) =>
          crepe.editor.action((ctx: Ctx) => {
            ctx.update(placeholderConfig.key, (prev) => ({ ...prev, text: next }));
            const view = viewOf(ctx);
            view.dispatch(view.state.tr); // re-run the decorations so the new hint shows now
          }),
        completeReference: (from, to, text, href) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = viewOf(ctx);
            const mark = commonmark.linkSchema.type(ctx).create({ href, title: null });
            const node = view.state.schema.text(text, [mark]);
            const tr = view.state.tr.replaceWith(from, to, node);
            tr.setSelection(state.Selection.near(tr.doc.resolve(from + text.length)));
            // Whatever is typed next (the message query, or just carrying on) must not extend the link.
            tr.setStoredMarks([]);
            view.dispatch(tr);
          }),
      };
      await crepe.create();
      const now = latest.current;
      crepe.setReadonly(now.readOnly);
      if (now.value !== v) {
        lastEmittedRef.current = now.value;
        crepe.editor.action(utils.replaceAll(now.value));
      }
      crepe.editor.action((ctx: Ctx) => {
        // iOS reads these off the contenteditable: sentence caps, and spell-check for prose.
        const dom = viewOf(ctx).dom;
        dom.setAttribute("autocapitalize", "sentences");
        dom.setAttribute("spellcheck", "true");
      });
      if (now.placeholder !== text) loadedRef.current?.setPlaceholder(now.placeholder);
      crepeRef.current = crepe;
      if (!now.readOnly) beginEditing();
      if (initial.current.autofocus) crepe.editor.action((ctx: Ctx) => viewOf(ctx).focus());
      destroy = () => crepe.destroy();
      if (destroyed) destroy();
    })();

    return () => {
      destroyed = true;
      destroy?.();
      loadedRef.current = null;
      crepeRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `readOnly` is the only trigger; the helpers are per-render closures over refs.
  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
    if (readOnly) {
      baselineRef.current = null;
      setDirty(false);
    } else if (baselineRef.current === null) beginEditing();
  }, [readOnly]);

  useEffect(() => {
    loadedRef.current?.setPlaceholder(placeholder);
  }, [placeholder]);

  // One-way sync for programmatic changes (a chat composer clearing on send).
  // A no-op on every keystroke (value === last emitted).
  useEffect(() => {
    const loaded = loadedRef.current;
    if (!loaded || value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    loaded.editor.action(loaded.replaceAll(value));
  }, [value]);

  useImperativeHandle(handleRef, () => ({
    setMarkdown: (md) => {
      const loaded = loadedRef.current;
      if (!loaded) return;
      lastEmittedRef.current = md;
      loaded.editor.action(loaded.replaceAll(md));
    },
    insertAtCaret: (text) => {
      const loaded = loadedRef.current;
      if (!loaded) return false;
      try {
        loaded.insertAtCaret(text, touchedRef.current);
        return true;
      } catch {
        return false; // handle is published just before crepe.create() finishes
      }
    },
    insertImage: (src) => {
      const loaded = loadedRef.current;
      if (!loaded) return false;
      try {
        loaded.insertImage(src, touchedRef.current);
        return true;
      } catch {
        return false;
      }
    },
    focus: () => {
      try {
        loadedRef.current?.focus(touchedRef.current);
      } catch {
        // editor still mounting — nothing to focus yet
      }
    },
    enterEdit: () => {
      const crepe = crepeRef.current;
      const loaded = loadedRef.current;
      if (!crepe || !loaded) return;
      // Synchronous on purpose: iOS raises the keyboard only for a focus() inside the tap itself.
      crepe.setReadonly(false);
      beginEditing();
      loaded.focus(false);
    },
    exitEdit: (discard) => {
      const crepe = crepeRef.current;
      const loaded = loadedRef.current;
      if (!crepe || !loaded) return;
      if (discard) {
        const original = latest.current.value;
        lastEmittedRef.current = original;
        loaded.editor.action(loaded.replaceAll(original));
      }
      crepe.setReadonly(true);
      loaded.blur();
      baselineRef.current = null;
      setDirty(false);
      closeAutocomplete();
    },
    isDirty: () => {
      const crepe = crepeRef.current;
      return crepe && baselineRef.current !== null ? isDirty(baselineRef.current, crepe.getMarkdown()) : false;
    },
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? lastEmittedRef.current,
  }));

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: focus bubbling only records "the user has been here"; the div isn't a control */}
      <div
        ref={containerRef}
        className={cn("threadz-md", className)}
        style={style}
        onKeyDownCapture={(e) => {
          const handled = handleReferenceKeyDown(
            e,
            local.state.stage !== "closed",
            ac.options.length,
            ac.highlighted,
            ac.setHighlighted,
            acceptReference,
            closeAutocomplete,
          );
          if (!handled) onKeyDownCapture?.(e);
        }}
        onPasteCapture={(e) => takeImageFile(e.clipboardData.files, onImageFile, e)}
        onDropCapture={(e) => takeImageFile(e.dataTransfer.files, onImageFile, e)}
        onFocus={() => {
          touchedRef.current = true;
        }}
        onBlur={closeAutocomplete}
        // Click-to-navigate for a completed reference: Crepe already renders `[text](thread=…)` as
        // a plain `<a>` (decision 1 — no new node type), so this is a plain click delegation, not a
        // ProseMirror `handleClickOn` (see referencePlugin.ts's comment for why that hook — which
        // resolves a click through `posAtCoords` — isn't the reliable choice here).
        onClickCapture={(e) => {
          const a = (e.target as HTMLElement).closest?.("a");
          const ref = a ? parseReferenceHref(a.getAttribute("href")) : null;
          if (!ref) return;
          e.preventDefault();
          onReferenceClickRef.current?.(
            ref.threadId,
            ref.messageId && messageRangeParam(ref.messageId, ref.toMessageId),
          );
        }}
      />
      <ReferenceAutocompleteMenu
        rect={local.rect}
        options={ac.options}
        highlighted={ac.highlighted}
        onPick={(id) => acceptReference(ac.options.findIndex((o) => o.id === id))}
        onOpenChange={(open) => {
          if (!open) closeAutocomplete();
        }}
      />
    </>
  );
};

// Pasting or dropping a photo: hand the file to the caller instead of letting the editor embed it.
const takeImageFile = (
  files: FileList | null | undefined,
  onImageFile: ((file: File) => void) | undefined,
  e: React.ClipboardEvent | React.DragEvent,
) => {
  const file = [...(files ?? [])].find((f) => f.type.startsWith("image/"));
  if (!file || !onImageFile) return;
  e.preventDefault();
  e.stopPropagation();
  onImageFile(file);
};

// Lucide `circle` / `circle-check`, stroke-only so `currentColor` (and the CSS) decide the colour.
const taskSvg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const TASK_OPEN = taskSvg('<circle cx="12" cy="12" r="10"/>');
const TASK_DONE = taskSvg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>');

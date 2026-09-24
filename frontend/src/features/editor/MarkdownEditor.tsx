// The shared WYSIWYG markdown editor (copied from wigl) — Milkdown's Crepe behind a
// controlled React wrapper. Used for the composer AND for editing / showing messages
// (`readOnly`). The libs are dynamic `import()`s inside the mount effect, so ProseMirror
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
  TRIGGER,
} from "@/lib/references";
import { padForInsert } from "@/lib/voice/text";
import { caretRect } from "./caretCoordinates";
import { imageView } from "./imageView";
import { ReferenceAutocompleteMenu } from "./ReferenceAutocompleteMenu";
import { handleReferenceKeyDown } from "./referenceKeyboard";
import { referencePlugin } from "./referencePlugin";
import { todoDecorationPlugin } from "./todoDecoration";
import { useReferenceAutocomplete } from "./useReferenceAutocomplete";
import "./markdown-editor.css";

/** Where the caret sits, in the SAME local-offset space `state` itself uses (an "anchor" into
 * whatever text this adapter is tracking) — used only to know where to measure a rect from; the
 * actual text edit always uses the offsets already carried on `state`/`completeThread`/
 * `completeMessage`'s return value, never this. */
const caretOffsetOf = (s: ReferenceAutocompleteState): number | null => {
  if (s.stage === "thread") return s.anchor + TRIGGER.length + s.query.length;
  if (s.stage === "message") return s.linkEnd + s.query.length;
  return null;
};

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
};

type EditorTrLike = {
  doc: { resolve: (pos: number) => ResolvedPos };
  setSelection: (s: unknown) => unknown;
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
  dispatch: (tr: unknown) => void;
  focus: () => void;
};

type Loaded = {
  editor: { action: (fn: (ctx: Ctx) => void) => void };
  replaceAll: (markdown: string) => (ctx: Ctx) => void;
  insertAtCaret: (text: string, touched: boolean) => void;
  insertImage: (src: string, touched: boolean) => void;
  /** Replace doc positions `[from, to)` with a single already-linked text node — how the reference
   * autocomplete (`lib/references.ts`'s `completeThread`/`completeMessage`) lands its result in the
   * live WYSIWYG view: `from`/`to` are absolute doc positions (the caller maps its own local,
   * block-relative offsets through `blockStart` first — see `referencePlugin.ts`). */
  completeReference: (from: number, to: number, text: string, href: string) => void;
};

export const MarkdownEditor = ({
  raw = false,
  placeholder = "start writing…",
  readOnly = false,
  onTodoToggle,
  onReferenceClick,
  ...rest
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  /** Display mode: same rendering, no caret. Toggles live. */
  readOnly?: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Capture phase — runs before ProseMirror's own handlers, so a caller can
   * claim a chord (e.g. ⌘Enter to send) with preventDefault + stopPropagation. */
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  /** Called with an image pasted or dropped into the editor (which then inserts nothing itself). */
  onImageFile?: (file: File) => void;
  /** A gutter checkbox (`@/todo` line, or an item inside a `@/todos` group) was clicked, naming the
   * line's index into `value.split("\n")`. WYSIWYG mode only (`raw` renders a plain textarea, no
   * decorations at all) — the caller re-derives the toggled content via `toggleTodoLine`
   * (`lib/todos.ts`) and persists it the same way it persists any other edit. See
   * `./todoDecoration.ts` and `ThreadView.tsx`'s `EntryRow`. */
  onTodoToggle?: (lineIndex: number) => void;
  /** A rendered reference link (`[text](thread=…)`, see `lib/references.ts`) was clicked. WYSIWYG
   * mode only — `raw` shows the literal markdown source, nothing there is a clickable link. The
   * caller navigates in-app (`App.tsx`'s `openThreadAt`), never a page reload. `messageId` is `<id>`
   * or, for a range, `<from>..<to>` (`lib/references.ts`'s `resolveMessageRange` reads it). */
  onReferenceClick?: (threadId: string, messageId: string | null) => void;
  /** Layout knobs are CSS vars, not props: `--md-padding` (default
   * `14px 18px 40px`) and `--md-max-height` (default none, else the editor
   * scrolls), `--md-min-height` (default 100%), `--md-img-max` (photo width, default 32rem). Set them from here, e.g. `[--md-padding:10px_12px]`. */
  className?: string;
  /** For a var that has to be a computed runtime value (a measured height), not a static
   * Tailwind arbitrary class — e.g. `{ "--md-min-height": "220px" }`. */
  style?: CSSProperties;
  /** Plain-text mode: a `<textarea>` showing the literal markdown source instead of WYSIWYG
   * rendering, for surfaces where the point is to select and delete raw syntax characters
   * (editing a message that already has `**bold**` etc. — there's no toolbar to undo it via
   * rendering). No lazy Milkdown load, so it's cheap and synchronous. Same imperative handle,
   * `onKeyDownCapture`, `placeholder`, `className` contract as the WYSIWYG surface, so any
   * caller can flip this on without other changes. */
  raw?: boolean;
  /** Focus once mounted, as soon as the editor is actually ready to receive it (Crepe loads
   * async — this waits for `crepe.create()`, it doesn't race it). A mount-time flag, not a
   * live prop: re-focusing on every render would steal focus back mid-edit. */
  autofocus?: boolean;
}) =>
  raw ? (
    <RawEditor {...rest} placeholder={placeholder} readOnly={readOnly} />
  ) : (
    <CrepeEditor
      {...rest}
      placeholder={placeholder}
      readOnly={readOnly}
      onTodoToggle={onTodoToggle}
      onReferenceClick={onReferenceClick}
    />
  );

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

// Raw mode: literal markdown text in a plain textarea. No ProseMirror, no rich image embed —
// `insertImage` just splices in the `![](src)` text, which is what "raw" means. Used for message
// inline edit mode and the note popover editor (ThreadView.tsx's EntryRow) — both editable, so both
// get the reference autocomplete (see `lib/references.ts`) wired straight onto the textarea itself:
// no ProseMirror here, so it drives the shared state machine off the DOM textarea's own
// value/selection instead of doc positions (CrepeEditor, below, is the other half).
const RawEditor = ({
  value,
  onChange,
  placeholder,
  readOnly,
  handleRef,
  onKeyDownCapture,
  onImageFile,
  className,
  style,
  autofocus,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder: string;
  readOnly: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  onImageFile?: (file: File) => void;
  className?: string;
  style?: CSSProperties;
  autofocus?: boolean;
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Has the user ever put a caret in here? Until then a programmatic insert (e.g. the image
  // button, which deliberately doesn't steal focus) goes to the end, matching the WYSIWYG surface.
  const touchedRef = useRef(false);
  const [refState, setRefState] = useState<ReferenceAutocompleteState>({ stage: "closed" });
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const ac = useReferenceAutocomplete(refState);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-time only, `autofocus` is read once by design.
  useEffect(() => {
    if (autofocus) ref.current?.focus();
  }, []);

  // Re-measure the caret's on-screen position whenever the autocomplete state changes (opens,
  // narrows, closes) — cheap (one hidden mirror-div layout, see `caretCoordinates.ts`), and only
  // ever runs while `refState.stage !== "closed"` mattered anyway.
  useEffect(() => {
    const el = ref.current;
    const at = caretOffsetOf(refState);
    setRect(el && at != null ? caretRect(el, at) : null);
  }, [refState]);

  const recomputeRefState = () => {
    const el = ref.current;
    if (!el || readOnly) return;
    const caret = el.selectionStart ?? el.value.length;
    setRefState((prev) => nextAutocompleteState(prev, el.value, caret));
  };

  const applyEdit = (edit: { from: number; to: number; text: string }, next: ReferenceAutocompleteState) => {
    const el = ref.current;
    if (!el) return;
    const nextValue = el.value.slice(0, edit.from) + edit.text + el.value.slice(edit.to);
    const caret = edit.from + edit.text.length;
    onChange?.(nextValue);
    el.value = nextValue; // same "keep the DOM in sync now" reasoning as spliceAtCaret below
    el.focus();
    el.setSelectionRange(caret, caret);
    setRefState(next);
  };

  const accept = (index: number) => {
    const opt = ac.options[index];
    if (!opt) return;
    if (refState.stage === "thread") {
      const thread = ac.findThread(opt.id);
      if (thread) {
        const { edit, next } = completeThread(refState, thread);
        applyEdit(edit, next);
      }
    } else if (refState.stage === "message") {
      const message = ac.findMessage(opt.id);
      if (message) {
        const { edit, next } = completeMessage(refState, message);
        applyEdit(edit, next);
      }
    }
  };

  const spliceAtCaret = (text: string) => {
    const el = ref.current;
    if (!el) return false;
    const len = el.value.length;
    const from = touchedRef.current ? (el.selectionStart ?? len) : len;
    const to = touchedRef.current ? (el.selectionEnd ?? len) : len;
    const next = el.value.slice(0, from) + text + el.value.slice(to);
    const caret = from + text.length;
    onChange?.(next);
    // Keep the DOM in sync now: a caller may read getMarkdown() or insert again before the
    // controlled `value` prop round-trips back through a render.
    el.value = next;
    el.setSelectionRange(caret, caret);
    return true;
  };

  useImperativeHandle(handleRef, () => ({
    getMarkdown: () => ref.current?.value ?? value,
    setMarkdown: (md) => {
      onChange?.(md);
      if (ref.current) ref.current.value = md;
    },
    insertAtCaret: (text) => spliceAtCaret(text),
    insertImage: (src) => spliceAtCaret(`![](${src})`),
  }));

  return (
    <>
      <textarea
        ref={ref}
        className={cn("threadz-md-raw", className)}
        style={style}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          onChange?.(e.target.value);
          recomputeRefState();
        }}
        onSelect={recomputeRefState}
        onKeyDownCapture={(e) => {
          const handled = handleReferenceKeyDown(
            e,
            refState.stage !== "closed",
            ac.options.length,
            ac.highlighted,
            ac.setHighlighted,
            accept,
            () => setRefState({ stage: "closed" }),
          );
          if (!handled) onKeyDownCapture?.(e);
        }}
        onPasteCapture={(e) => takeImageFile(e.clipboardData.files, onImageFile, e)}
        onDropCapture={(e) => takeImageFile(e.dataTransfer.files, onImageFile, e)}
        onFocus={() => {
          touchedRef.current = true;
        }}
        onBlur={() => setRefState({ stage: "closed" })}
      />
      <ReferenceAutocompleteMenu
        rect={rect}
        options={ac.options}
        highlighted={ac.highlighted}
        emptyText={refState.stage === "thread" ? "No matching threads" : "No matching messages"}
        onPick={(id) => accept(ac.options.findIndex((o) => o.id === id))}
        onOpenChange={(open) => {
          if (!open) setRefState({ stage: "closed" });
        }}
      />
    </>
  );
};

const CrepeEditor = ({
  value,
  onChange,
  placeholder,
  readOnly,
  handleRef,
  onKeyDownCapture,
  onImageFile,
  onTodoToggle,
  onReferenceClick,
  className,
  style,
  autofocus,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder: string;
  readOnly: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  onImageFile?: (file: File) => void;
  onTodoToggle?: (lineIndex: number) => void;
  onReferenceClick?: (threadId: string, messageId: string | null) => void;
  className?: string;
  style?: CSSProperties;
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
  // Latest markdown Crepe emitted — lets the value-sync effect skip the echo
  // of the user's own typing.
  const lastEmittedRef = useRef(value);
  // Mount-time inputs, read inside the async effect without becoming deps.
  const initial = useRef({ value, placeholder, autofocus });
  // What the props say right now, so an update that lands while Crepe is still loading isn't lost.
  const latest = useRef({ value, readOnly });
  latest.current = { value, readOnly };
  // Has the user ever put a caret in here? Until then a programmatic insert goes to the end
  // (ProseMirror's untouched selection sits at the very start, i.e. *before* a restored draft).
  const touchedRef = useRef(false);
  const crepeRef = useRef<{ setReadonly: (v: boolean) => unknown; getMarkdown: () => string } | null>(null);
  // The reference autocomplete's live state, reported by `referencePlugin.ts`'s `onLocalUpdate` on
  // every selection/doc change and advanced through the SAME `nextAutocompleteState` RawEditor
  // drives from a plain textarea's value/selection instead — see that file's own comment for why
  // "message" stage can't just be re-derived from arbitrary rendered text the way "thread" stage is.
  // `blockStart` is what turns `state`'s local (block-relative) offsets back into real doc positions
  // for `completeReference`; bundled with `state`/`rect` so all three always describe the same update.
  const [local, setLocal] = useState<{
    state: ReferenceAutocompleteState;
    rect: { left: number; top: number; bottom: number } | null;
    blockStart: number;
  }>({ state: { stage: "closed" }, rect: null, blockStart: 0 });
  const ac = useReferenceAutocomplete(local.state);

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
      setLocal((l) => ({ ...l, state: next }));
    } else if (st.stage === "message") {
      const message = ac.findMessage(opt.id);
      if (!message) return;
      const { edit, next, href } = completeMessage(st, message);
      loaded.completeReference(local.blockStart + edit.from, local.blockStart + edit.to, st.displayText, href);
      setLocal((l) => ({ ...l, state: next }));
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;
    housekeeping(); // once per page load: persistent-storage request + orphan sweep

    (async () => {
      const [
        { CrepeBuilder },
        { listItem },
        { placeholder: placeholderFeature },
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
        .addFeature(listItem)
        // "doc": show the placeholder only when the whole field is empty —
        // "block" re-shows it on every empty line, which reads as "my text
        // disappeared".
        .addFeature(placeholderFeature, { text, mode: "doc" });
      // Photos: `img:` refs render as lazy grey boxes (./imageView.ts).
      crepe.editor.use(utils.$view(commonmark.imageSchema.node, () => imageView));
      // `@/todo`/`@/todos` lines: gutter checkbox + highlight decoration, no new node type
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
      // editable — reporting this text block's plain text/caret so React can drive the same
      // trigger/two-stage-autocomplete state machine RawEditor's textarea wiring drives.
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
        completeReference: (from, to, text, href) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = viewOf(ctx);
            const mark = commonmark.linkSchema.type(ctx).create({ href, title: null });
            const node = view.state.schema.text(text, [mark]);
            const tr = view.state.tr.replaceWith(from, to, node);
            tr.setSelection(state.Selection.near(tr.doc.resolve(from + text.length)));
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
      if (initial.current.autofocus) crepe.editor.action((ctx: Ctx) => viewOf(ctx).focus());
      crepeRef.current = crepe;
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

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
  }, [readOnly]);

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
            () => setLocal((l) => ({ ...l, state: { stage: "closed" }, rect: null })),
          );
          if (!handled) onKeyDownCapture?.(e);
        }}
        onPasteCapture={(e) => takeImageFile(e.clipboardData.files, onImageFile, e)}
        onDropCapture={(e) => takeImageFile(e.dataTransfer.files, onImageFile, e)}
        onFocus={() => {
          touchedRef.current = true;
        }}
        onBlur={() => setLocal((l) => ({ ...l, state: { stage: "closed" }, rect: null }))}
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
        emptyText={local.state.stage === "thread" ? "No matching threads" : "No matching messages"}
        onPick={(id) => acceptReference(ac.options.findIndex((o) => o.id === id))}
        onOpenChange={(open) => {
          if (!open) setLocal((l) => ({ ...l, state: { stage: "closed" }, rect: null }));
        }}
      />
    </>
  );
};

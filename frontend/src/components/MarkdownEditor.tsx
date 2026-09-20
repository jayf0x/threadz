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
import type { Node } from "@milkdown/kit/prose/model";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/cn";
import { padForInsert } from "@/lib/voice/text";
import "./markdown-editor.css";

export type MarkdownEditorHandle = {
  /** Move focus into the editor and drop the caret at the very end. */
  focusEnd: () => void;
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
};

type Loaded = {
  editor: { action: (fn: (ctx: Ctx) => void) => void };
  replaceAll: (markdown: string) => (ctx: Ctx) => void;
  focusEnd: () => void;
  insertAtCaret: (text: string, touched: boolean) => void;
};

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = "start writing…",
  formatOnType = true,
  readOnly = false,
  handleRef,
  onKeyDownCapture,
  className,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  /** `false` keeps `# ` and ``` as literal text instead of reshaping the
   * editor mid-keystroke (a chat prompt, not a document). Read once at mount. */
  formatOnType?: boolean;
  /** Display mode: same rendering, no caret. Toggles live. */
  readOnly?: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Capture phase — runs before ProseMirror's own handlers, so a caller can
   * claim a chord (e.g. ⌘Enter to send) with preventDefault + stopPropagation. */
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  /** Layout knobs are CSS vars, not props: `--md-padding` (default
   * `14px 18px 40px`) and `--md-max-height` (default none, else the editor
   * scrolls), `--md-min-height` (default 100%). Set them from here, e.g. `[--md-padding:10px_12px]`. */
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest markdown Crepe emitted — lets the value-sync effect skip the echo
  // of the user's own typing.
  const lastEmittedRef = useRef(value);
  // Mount-time inputs, read inside the async effect without becoming deps.
  const initial = useRef({ value, placeholder, formatOnType, readOnly });
  // Has the user ever put a caret in here? Until then a programmatic insert goes to the end
  // (ProseMirror's untouched selection sits at the very start, i.e. *before* a restored draft).
  const touchedRef = useRef(false);
  const crepeRef = useRef<{ setReadonly: (v: boolean) => unknown; getMarkdown: () => string } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;

    (async () => {
      const [{ CrepeBuilder }, { listItem }, { placeholder: placeholderFeature }, commonmark, core, state, utils] =
        await Promise.all([
          import("@milkdown/crepe/builder"),
          import("@milkdown/crepe/feature/list-item"),
          import("@milkdown/crepe/feature/placeholder"),
          import("@milkdown/kit/preset/commonmark"),
          import("@milkdown/kit/core"),
          import("@milkdown/kit/prose/state"),
          import("@milkdown/kit/utils"),
        ]);
      if (destroyed || !containerRef.current) return;

      const { value: v, placeholder: text, formatOnType: format, readOnly: ro } = initial.current;
      const crepe = new CrepeBuilder({ root: containerRef.current, defaultValue: v })
        .addFeature(listItem)
        // "doc": show the placeholder only when the whole field is empty —
        // "block" re-shows it on every empty line, which reads as "my text
        // disappeared".
        .addFeature(placeholderFeature, { text, mode: "doc" });
      crepe.on((api: { markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void }) => {
        api.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          onChangeRef.current?.(markdown);
        });
      });
      // Remove the typed triggers (input rules + keymaps) for headings and
      // fenced code; the nodes stay in the schema so pasted markdown still
      // round-trips.
      if (!format)
        await crepe.editor.remove([
          commonmark.wrapInHeadingInputRule,
          ...commonmark.headingKeymap,
          commonmark.createCodeBlockInputRule,
          ...commonmark.codeBlockKeymap,
        ]);

      loadedRef.current = {
        editor: crepe.editor,
        replaceAll: utils.replaceAll,
        focusEnd: () =>
          crepe.editor.action((ctx: Ctx) => {
            const view = ctx.get(core.editorViewCtx) as EditorViewLike;
            view.dispatch(view.state.tr.setSelection(state.Selection.atEnd(view.state.doc)));
            view.focus();
          }),
        insertAtCaret: (text, touched) =>
          crepe.editor.action((ctx: Ctx) => {
            const view = ctx.get(core.editorViewCtx) as EditorViewLike;
            const { doc } = view.state;
            const at = touched ? view.state.selection.to : state.Selection.atEnd(doc).to;
            const around = (from: number, to: number) =>
              doc.textBetween(Math.max(0, from), Math.min(doc.content.size, to), " ");
            const pad = padForInsert(around(at - 1, at), around(at, at + 1), text);
            const tr = view.state.tr.insertText(pad.text, at);
            tr.setSelection(state.Selection.near(tr.doc.resolve(at + pad.caretOffset) as never));
            view.dispatch(tr);
          }),
      };
      await crepe.create();
      crepe.setReadonly(ro);
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
    focusEnd: () => loadedRef.current?.focusEnd(),
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
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? lastEmittedRef.current,
  }));

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus bubbling only records "the user has been here"; the div isn't a control
    <div
      ref={containerRef}
      className={cn("threadz-md", className)}
      onKeyDownCapture={onKeyDownCapture}
      onFocus={() => {
        touchedRef.current = true;
      }}
    />
  );
};

type EditorTrLike = {
  doc: { resolve: (pos: number) => unknown };
  setSelection: (s: unknown) => unknown;
  insertText: (t: string, from: number) => EditorTrLike;
};

// Minimal shape of the ProseMirror EditorView bits focusEnd touches — keeps
// prose types (and their document-touching modules) out of the static graph.
type EditorViewLike = {
  state: {
    tr: { setSelection: (s: unknown) => unknown; insertText: (t: string, from: number) => EditorTrLike };
    doc: Node;
    selection: { to: number };
  };
  dispatch: (tr: unknown) => void;
  focus: () => void;
};

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
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/cn";
import { padForInsert } from "@/lib/voice/text";
import { imageView } from "./imageView";
import "./markdown-editor.css";

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
};

// Minimal shape of the ProseMirror EditorView bits the insert helpers touch — keeps
// prose types (and their document-touching modules) out of the static graph.
type EditorViewLike = {
  state: {
    tr: {
      setSelection: (s: unknown) => unknown;
      insertText: (t: string, from: number) => EditorTrLike;
      insert: (at: number, node: unknown) => EditorTrLike;
    };
    doc: Node;
    selection: { to: number };
  };
  dispatch: (tr: unknown) => void;
  focus: () => void;
};

type Loaded = {
  editor: { action: (fn: (ctx: Ctx) => void) => void };
  replaceAll: (markdown: string) => (ctx: Ctx) => void;
  insertAtCaret: (text: string, touched: boolean) => void;
  insertImage: (src: string, touched: boolean) => void;
};

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = "start writing…",
  readOnly = false,
  handleRef,
  onKeyDownCapture,
  onImageFile,
  className,
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
  /** Layout knobs are CSS vars, not props: `--md-padding` (default
   * `14px 18px 40px`) and `--md-max-height` (default none, else the editor
   * scrolls), `--md-min-height` (default 100%), `--md-img-max` (photo width, default 32rem). Set them from here, e.g. `[--md-padding:10px_12px]`. */
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
  const initial = useRef({ value, placeholder });
  // What the props say right now, so an update that lands while Crepe is still loading isn't lost.
  const latest = useRef({ value, readOnly });
  latest.current = { value, readOnly };
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

      const { value: v, placeholder: text } = initial.current;
      const crepe = new CrepeBuilder({ root: containerRef.current, defaultValue: v })
        .addFeature(listItem)
        // "doc": show the placeholder only when the whole field is empty —
        // "block" re-shows it on every empty line, which reads as "my text
        // disappeared".
        .addFeature(placeholderFeature, { text, mode: "doc" });
      // Photos: `img:` refs render as lazy grey boxes (./imageView.ts).
      crepe.editor.use(utils.$view(commonmark.imageSchema.node, () => imageView));
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
      };
      await crepe.create();
      const now = latest.current;
      crepe.setReadonly(now.readOnly);
      if (now.value !== v) {
        lastEmittedRef.current = now.value;
        crepe.editor.action(utils.replaceAll(now.value));
      }
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

  // Pasting or dropping a photo: hand the file to the caller instead of letting ProseMirror embed it.
  const takeFile = (e: React.ClipboardEvent | React.DragEvent, files: FileList | null | undefined) => {
    const file = [...(files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file || !onImageFile) return;
    e.preventDefault();
    e.stopPropagation();
    onImageFile(file);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus bubbling only records "the user has been here"; the div isn't a control
    <div
      ref={containerRef}
      className={cn("threadz-md", className)}
      onKeyDownCapture={onKeyDownCapture}
      onPasteCapture={(e) => takeFile(e, e.clipboardData.files)}
      onDropCapture={(e) => takeFile(e, e.dataTransfer.files)}
      onFocus={() => {
        touchedRef.current = true;
      }}
    />
  );
};

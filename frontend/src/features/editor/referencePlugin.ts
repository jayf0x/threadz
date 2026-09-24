// Type-only, same reasoning as todoDecoration.ts's own header comment: the real prosemirror-state
// classes are handed in by MarkdownEditor.tsx (already loaded dynamically there), so this file never
// pulls ProseMirror into the static import graph on its own.
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };

// What the plugin reports up to React (CrepeEditor) on every selection/doc change, so the
// autocomplete state machine (`lib/references.ts`'s `nextAutocompleteState` — the SAME function
// RawEditor's plain-textarea wiring drives) can run identically here: `text`/`caret` are just the
// current text block's plain content and the caret's offset into it (never the whole document —
// see the comment below on why), and `blockStart` is what a completion action needs to turn those
// local offsets back into real ProseMirror doc positions for its transaction.
export type ReferenceLocalUpdate = {
  text: string;
  caret: number;
  blockStart: number;
  /** Viewport-relative, from `view.coordsAtPos` — same coordinate space `caretCoordinates.ts`
   * hands the raw-textarea adapter, so `ReferenceAutocompleteMenu` doesn't need to care which
   * adapter it's anchored to. */
  rect: { left: number; top: number; bottom: number };
} | null; // null: selection isn't a collapsed caret inside a single text block — nothing to offer

export type ReferencePluginOptions = {
  onLocalUpdate: (update: ReferenceLocalUpdate) => void;
};

const localUpdateOf = (view: EditorView): ReferenceLocalUpdate => {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;
  const blockStart = $from.start();
  const coords = view.coordsAtPos($from.pos);
  return {
    text: $from.parent.textContent,
    caret: $from.pos - blockStart,
    blockStart,
    rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
  };
};

// The autocomplete-driving half of References in the live Crepe/ProseMirror view: reports the
// current text block's plain text and caret on every selection/doc change (only relevant while
// editable — see MarkdownEditor.tsx's CrepeEditor). Click-to-navigate for a completed reference
// lives beside this as a plain click handler on the editor's container `<div>` instead of a
// ProseMirror `handleClickOn` — that hook resolves the click through `posAtCoords`, which needs a
// real, laid-out DOM (it isn't reliable headless, e.g. under a test's happy-dom); event delegation
// on the rendered `<a>` itself (Crepe already renders one, no new node type) needs nothing from
// ProseMirror at all and is exactly as correct. No decorations either, unlike `todoDecoration.ts`:
// a reference is a REAL markdown link, so there's nothing here to draw that Crepe doesn't already.
export const referencePlugin = (prose: ProseStateModule, opts: ReferencePluginOptions) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-reference"),
    view(view: EditorView) {
      const report = () => opts.onLocalUpdate(localUpdateOf(view));
      report();
      return { update: report };
    },
  });

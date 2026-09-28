// Type-only, same reasoning as referencePlugin.ts/todoDecoration.ts: the real prosemirror-state
// classes are handed in by MarkdownEditor.tsx (already loaded dynamically there), so this file never
// pulls ProseMirror into the static import graph on its own.
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };

// What the plugin reports up to React (`MarkdownEditor`) on every selection/doc change, for the
// selection→link flow (AGENTS.md "Making connections with one thumb: select text or long-press →
// menu"): `from`/`to` are absolute doc positions (fed straight into `completeReference`, same as the
// `[[` autocomplete's `edit.from`/`edit.to`), and `text` is exactly what's selected — kept as-is as
// the link's display text, never replaced with a picked entity's own title the way `completeThread`
// does for a typed `[[`. `null`: nothing (a collapsed caret, a selection spanning more than one text
// block, or all-whitespace) — same "narrow, defensive" spirit as `referencePlugin.ts`'s own
// `localUpdateOf`, a false negative here just means no floating "Link" trigger shows.
export type SelectionUpdate = {
  from: number;
  to: number;
  text: string;
  rect: { left: number; top: number; bottom: number };
} | null;

export type SelectionPluginOptions = { onSelectionUpdate: (update: SelectionUpdate) => void };

const selectionUpdateOf = (view: EditorView): SelectionUpdate => {
  const { selection } = view.state;
  if (selection.empty) return null;
  const { $from, $to } = selection;
  if (!$from.parent.isTextblock || $from.parent !== $to.parent) return null;
  const text = view.state.doc.textBetween(selection.from, selection.to, "\n");
  if (!text.trim()) return null;
  const start = view.coordsAtPos(selection.from);
  const end = view.coordsAtPos(selection.to);
  return {
    from: selection.from,
    to: selection.to,
    text,
    rect: { left: start.left, top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) },
  };
};

// The selection-detecting half of "making connections with one thumb": reports the live selection's
// doc range, text and viewport rect on every selection/doc change (only meaningful while editable —
// `MarkdownEditor` only shows the resulting trigger when `!readOnly`). No decorations, same reasoning
// as `referencePlugin.ts`: nothing here needs drawing, it's a plain state report a `view()`-hooked
// plugin can produce for free on every ProseMirror `update`.
export const selectionPlugin = (prose: ProseStateModule, opts: SelectionPluginOptions) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-selection"),
    view(view: EditorView) {
      const report = () => opts.onSelectionUpdate(selectionUpdateOf(view));
      report();
      return { update: report };
    },
  });

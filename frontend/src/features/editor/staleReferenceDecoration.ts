// Type-only, same reasoning as todoDecoration.ts's own header comment: the real prosemirror-state/
// -view classes are handed in by the caller (already loaded dynamically in MarkdownEditor.tsx's
// mount effect), so this file never pulls ProseMirror into the static import graph on its own.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { isReferenceHref, parseReferenceHref } from "@/lib/references";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };
type ProseViewModule = { Decoration: typeof Decoration; DecorationSet: typeof DecorationSet };

export type StaleReferenceOptions = {
  /** Whether `noteId`'s pinned `versionId` is stale, read fresh on every `decorations()` call (same
   * "never capture a snapshot" discipline as todoDecoration.ts's `getValue`) — `undefined` means
   * "not checked yet," which is what drives `onUnknown` below. Backed by a small cache the caller
   * (MarkdownEditor.tsx) fills in asynchronously via `core`'s `isReferenceStale`; ProseMirror's own
   * `decorations()` hook has no way to await anything, so the check itself can only ever happen
   * outside it. */
  isStale: (noteId: string, versionId: string) => boolean | undefined;
  /** A pinned reference this plugin hasn't seen a staleness answer for yet — the caller looks it up
   * and, once known, needs to force a redraw itself (nothing here re-runs `decorations()` on its
   * own; see MarkdownEditor.tsx's `view.dispatch(view.state.tr)` after the cache fills in). */
  onUnknown: (noteId: string, versionId: string) => void;
};

// A small "stale" chip right after a *pinned* `tz:note/<id>@<version>` reference whose pinned
// version is no longer the note's latest one (docs/direction.md "Versions"). Only a pinned note
// reference can go stale — a live one (no `@version`) always follows the latest by definition, and
// link/property-set references aren't versioned at all. Nothing in the app writes a pinned
// reference yet (see lib/references.ts's header comment), so this stays dark until a later feature
// does; the mechanism is built ahead of that the same way the `version` field already sits unused
// in `ParsedReference`.
export const staleReferenceDecorationPlugin = (
  prose: ProseStateModule,
  view: ProseViewModule,
  opts: StaleReferenceOptions,
) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-stale-reference"),
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node: ProseNode, pos: number) => {
          if (!node.isText) return;
          const mark = node.marks.find((m) => m.type.name === "link");
          if (!mark) return;
          const href = String(mark.attrs.href ?? "");
          if (!isReferenceHref(href)) return;
          const ref = parseReferenceHref(href);
          if (!ref || !("kind" in ref) || ref.kind !== "note" || !ref.version) return;
          const stale = opts.isStale(ref.id, ref.version);
          if (stale === undefined) {
            opts.onUnknown(ref.id, ref.version);
            return;
          }
          if (!stale) return;
          const end = pos + node.nodeSize;
          decorations.push(
            view.Decoration.widget(end, () => staleChipDom(), {
              side: 1,
              key: `stale-${ref.id}-${ref.version}`,
            }),
          );
        });
        return view.DecorationSet.create(state.doc, decorations);
      },
    },
  });

// A small neutral pill matching `components/ui/Chip.tsx`'s own `colorSlot: null` look (`bg-secondary`/
// `text-secondary-foreground` — semantic tokens, never a literal colour) — Chip itself is a React
// component and can't mount into Milkdown's plain DOM tree (see todoDecoration.ts's checkbox for the
// same constraint), so this hand-builds the same visual contract: a colour cue plus an icon, per
// docs/direction.md's "a chip is a value, link, todo or version marker: a colour slot plus an icon or
// text as a second cue." Lucide's `clock` glyph (stroke-only, `currentColor`), same convention
// todoDecoration.ts's checkbox SVGs use.
const CLOCK = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';

const staleChipDom = () => {
  const span = document.createElement("span");
  span.className = "threadz-ref-stale";
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", "Reference is out of date");
  span.title = "This reference points at an older version of the note";
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CLOCK}</svg>`;
  return span;
};

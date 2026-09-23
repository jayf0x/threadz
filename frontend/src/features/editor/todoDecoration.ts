// Type-only: erased at compile time, same reasoning as MarkdownEditor.tsx's own type-only prose
// imports — the actual prosemirror-state/-view classes are handed in by the caller (already loaded
// dynamically inside MarkdownEditor's mount effect), so this file never pulls ProseMirror into the
// static import graph on its own.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
// `lib/todos.ts` is a plain, dependency-free module (no ProseMirror, no React) — a normal static
// import, unlike the prose types above. Only the read-only parsers: this file never mutates
// content itself, it just needs to know which paragraph is which line and whether it's done. The
// actual toggle (`toggleTodoLine`) is left to the caller of `onTodoToggle` (ThreadView.tsx's
// `EntryRow`, which already holds the message's full content) — see backlog.md "The full gutter".
import { type ParsedTodoItem, parseTodoGroups, parseTodos } from "@/lib/todos";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };
type ProseViewModule = { Decoration: typeof Decoration; DecorationSet: typeof DecorationSet };

// Decoration-only rendering for `@/todo <text>` command lines inside the message view (see
// backlog.md "Todo commands" step 4, the feedback round that replaced the old clickable widget
// with CSS-only highlighting, and "Todo feedback round 2" item 2, which brings a checkbox back —
// as a rail beside the paragraph, not inline in it). `@/todo` and `@/todos <title>` aren't real
// markdown, so there's no AST node for either — this doesn't add one; it decorates a top-level
// paragraph whose *rendered* text starts with one of the two triggers, plus (for a `@/todos`
// group) every list-item line in the contiguous run right after it.
//
// The `~~…~~` strikethrough that marks a single `@/todo` line done is real GFM (already parsed by
// Crepe's bundled `gfm` preset), so a closed todo's paragraph text reads identically to an open
// one; the paragraph's own done/fade styling still reads that off the `strike_through` mark
// (`isDone`, unchanged from the CSS-only round). The checkbox widget's own open/closed state is a
// *separate* read, straight off `parseTodos`/`parseTodoGroups(getValue())` on every `decorations()`
// call — never a cached/ref'd copy — so a stale render can't show a box that doesn't match the
// message's actual current content (see backlog.md point 4, "state management").
const TODO_TOKEN = "@/todo";
const TODO_PREFIX = /^@\/todo(?:\s|$)/;
// `@/todos <title>` — the group trigger. A local, lightweight matcher (same convention as
// TODO_PREFIX above), deliberately not `lib/todos.ts`'s own unexported `GROUP_TRIGGER` — this file
// only ever needs "does this paragraph's text start with the trigger", not the full parse.
const TODOS_TOKEN = "@/todos";
const TODOS_PREFIX = /^@\/todos(?:\s|$)/;

const isDone = (node: ProseNode) =>
  node.childCount > 0 && node.child(0).marks.some((m) => m.type.name === "strike_through");

// Lucide's `square` / `square-check` glyphs, hand-drawn here rather than importing `lucide-react`:
// a widget's DOM is built with `document.createElement`, not JSX, so there's no React tree for a
// `lucide-react` component to render into. Same 24×24/stroke-2 shape as `TodosPanel.tsx`'s icons.
const SQUARE = '<rect width="18" height="18" x="3" y="3" rx="2"/>';
const SQUARE_CHECK = '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>';

// `data-row-select-ignore` mirrors `features/threads/rowSelect.ts`'s `ROW_SELECT_IGNORE` constant
// verbatim, kept as a literal rather than imported: `rowSelect.ts` isn't re-exported from
// `features/threads/index.ts`, and importing it directly would reach past that boundary (AGENTS.md)
// *and* point this feature back at `threads`, which already depends on `editor` — a cycle. A click
// on this checkbox must not also select/deselect the message row it's drawn over.
const ROW_SELECT_IGNORE_ATTR = "data-row-select-ignore";

const checkboxDom = (done: boolean, onToggle: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "threadz-todo-checkbox";
  button.setAttribute("aria-pressed", String(done));
  button.setAttribute("aria-label", done ? "Mark todo open" : "Mark todo done");
  button.setAttribute(ROW_SELECT_IGNORE_ATTR, "");
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${done ? SQUARE_CHECK : SQUARE}</svg>`;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  });
  return button;
};

export type TodoDecorationOptions = {
  /** The message's current markdown, read fresh on every `decorations()` call — never captured
   * once at plugin-creation time, since the plugin itself is only built once per editor mount but
   * `value` can change under it (an edit elsewhere, a sync pulling in a remote change). */
  getValue: () => string;
  /** Whether a checkbox should render at all right now, read fresh on every `decorations()` call
   * (same reasoning as `getValue` — MarkdownEditor.tsx's wrapper around `onToggle` below is always
   * a defined function, so this is what actually decides "highlight only" vs "highlight + gutter
   * checkbox," not `onToggle`'s own presence). False for notes, scratch answers, history — anywhere
   * there's no sensible "edit this message" action to wire a click to. */
  hasToggle: () => boolean;
  /** A gutter checkbox was clicked, naming the exact line (`content.split("\n")` index) to flip. */
  onToggle: (lineIndex: number) => void;
};

// `prose`/`view` are the already-loaded `@milkdown/kit/prose/{state,view}` modules (MarkdownEditor.tsx
// loads both dynamically).
export const todoDecorationPlugin = (prose: ProseStateModule, view: ProseViewModule, opts: TodoDecorationOptions) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-todo-decoration"),
    props: {
      decorations(state) {
        const value = opts.getValue();
        const flatTodos = parseTodos(value); // already excludes lines a group below consumed
        const groups = parseTodoGroups(value).groups;
        const decorations: Decoration[] = [];
        let todoPtr = 0;
        let groupPtr = 0;
        // The group whose contiguous item list is expected right after the paragraph just seen —
        // `parseTodoGroups` guarantees a matched trigger is always followed by at least one item
        // line, in the same order Crepe rendered them in, so a `bullet_list` immediately following
        // a matched `@/todos` paragraph is always that group's own list.
        let pendingItems: ParsedTodoItem[] | null = null;

        const pushLine = (offset: number, nodeSize: number, lead: number, tokenLen: number, done: boolean) => {
          const lineClass = done ? "threadz-todo-line threadz-todo-line--done" : "threadz-todo-line";
          const tokenStart = offset + 1 + lead;
          decorations.push(view.Decoration.inline(tokenStart, tokenStart + tokenLen, { class: "threadz-todo-token" }));
          decorations.push(view.Decoration.node(offset, offset + nodeSize, { class: lineClass }));
        };

        const pushCheckbox = (pos: number, done: boolean, lineIndex: number | undefined) => {
          if (!opts.hasToggle() || lineIndex === undefined) return;
          const onToggle = opts.onToggle;
          decorations.push(
            view.Decoration.widget(pos, () => checkboxDom(done, () => onToggle(lineIndex)), {
              side: -1,
              key: `todo-${lineIndex}-${done}`,
              stopEvent: () => true,
            }),
          );
        };

        state.doc.forEach((node, offset) => {
          if (node.type.name === "paragraph") {
            const text = node.textContent;
            const lead = text.length - text.trimStart().length; // leading whitespace, if any
            const trimmed = text.slice(lead);
            if (TODOS_PREFIX.test(trimmed)) {
              // The group's own title line: highlight only (per backlog.md, it's a title, not
              // itself a todo), then arm `pendingItems` for the bullet_list right after it.
              pushLine(offset, node.nodeSize, lead, TODOS_TOKEN.length, isDone(node));
              pendingItems = groups[groupPtr]?.items ?? null;
              groupPtr++;
              return;
            }
            if (TODO_PREFIX.test(trimmed)) {
              const entry = flatTodos[todoPtr];
              todoPtr++;
              const done = entry?.done ?? isDone(node);
              pushLine(offset, node.nodeSize, lead, TODO_TOKEN.length, done);
              pushCheckbox(offset + 1, done, entry?.lineIndex);
              pendingItems = null;
              return;
            }
            pendingItems = null;
            return;
          }
          if (node.type.name === "bullet_list" && pendingItems) {
            const items = pendingItems;
            pendingItems = null;
            let idx = 0;
            let itemPos = offset + 1; // enter the bullet_list's own content
            node.forEach((listItem) => {
              const item = items[idx];
              idx++;
              const para = listItem.childCount > 0 ? listItem.child(0) : null;
              if (para?.type.name === "paragraph" && item) {
                // itemPos (list_item start) + 1 enters the list_item's content (the paragraph
                // start) + 1 again enters the paragraph's own content — same "+1" the flat-todo
                // case uses above, just one level deeper.
                pushCheckbox(itemPos + 2, item.done, item.lineIndex);
              }
              itemPos += listItem.nodeSize;
            });
            return;
          }
          pendingItems = null;
        });

        return view.DecorationSet.create(state.doc, decorations);
      },
    },
  });

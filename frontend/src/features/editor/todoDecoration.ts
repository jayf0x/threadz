// Type-only: erased at compile time, same reasoning as MarkdownEditor.tsx's own type-only prose
// imports — the actual prosemirror-state/-view classes are handed in by the caller (already loaded
// dynamically inside MarkdownEditor's mount effect), so this file never pulls ProseMirror into the
// static import graph on its own.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };
type ProseViewModule = { Decoration: typeof Decoration; DecorationSet: typeof DecorationSet };

// Decoration-only rendering for `@/todo <text>` command lines inside the message view (see
// backlog.md "Todo commands" step 4, and the feedback round that replaced this). First cut had a
// clickable checkbox widget prepended to the line — feedback: "it's meant to be markdown first,
// now it kind of awkwardly floats next to it." This is the CSS-only follow-up: no widget, no click
// target, just the `@/todo` token and the line itself marked up for styling
// (markdown-editor.css's `.threadz-todo-token` / `.threadz-todo-line`). State edits go back to
// sidebar-only or raw-edit-mode only, same as the legacy `- [ ] ` syntax already is.
//
// `@/todo` isn't real markdown, so there's no AST node for it — this doesn't add one either; it
// just decorates a top-level paragraph whose *rendered* text starts with `@/todo`. The `~~…~~`
// strikethrough that marks a todo done is real GFM (already parsed by Crepe's bundled `gfm`
// preset — no extra plugin needed here), so a closed todo's paragraph text reads identically to an
// open one; `done` is read off the `strike_through` mark on its content, to fade the highlight
// instead of competing with the strikethrough.
const TODO_TOKEN = "@/todo";
const TODO_PREFIX = /^@\/todo(?:\s|$)/;

const isDone = (node: ProseNode) =>
  node.childCount > 0 && node.child(0).marks.some((m) => m.type.name === "strike_through");

// `prose`/`view` are the already-loaded `@milkdown/kit/prose/{state,view}` modules (MarkdownEditor.tsx
// loads both dynamically). No callbacks in or out any more — this plugin only ever adds decorations,
// never mutates anything, so the doc's own content is the entire input.
export const todoDecorationPlugin = (prose: ProseStateModule, view: ProseViewModule) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-todo-decoration"),
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.forEach((node, offset) => {
          if (node.type.name !== "paragraph") return;
          const text = node.textContent;
          const lead = text.length - text.trimStart().length; // leading whitespace, if any
          if (!TODO_PREFIX.test(text.slice(lead))) return;
          const lineClass = isDone(node) ? "threadz-todo-line threadz-todo-line--done" : "threadz-todo-line";
          const tokenStart = offset + 1 + lead; // +1: inside the paragraph, before its first inline child
          decorations.push(
            view.Decoration.inline(tokenStart, tokenStart + TODO_TOKEN.length, { class: "threadz-todo-token" }),
          );
          decorations.push(view.Decoration.node(offset, offset + node.nodeSize, { class: lineClass }));
        });
        return view.DecorationSet.create(state.doc, decorations);
      },
    },
  });

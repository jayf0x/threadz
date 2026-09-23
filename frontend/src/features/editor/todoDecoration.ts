// Type-only: erased at compile time, same reasoning as MarkdownEditor.tsx's own type-only prose
// imports — the actual prosemirror-state/-view classes are handed in by the caller (already loaded
// dynamically inside MarkdownEditor's mount effect), so this file never pulls ProseMirror into the
// static import graph on its own.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { parseTodos, toggleTodoLine } from "@/lib/todos";

type ProseStateModule = { Plugin: typeof Plugin; PluginKey: typeof PluginKey };
type ProseViewModule = { Decoration: typeof Decoration; DecorationSet: typeof DecorationSet };

// Decoration-only rendering for `@/todo <text>` command lines inside the read-only message view
// (see backlog.md "Todo commands" step 4). `@/todo` isn't real markdown, so there's no AST node for
// it — this doesn't add one either; it just decorates a top-level paragraph whose *rendered* text
// starts with `@/todo` with a clickable checkbox widget, the same way `TodosPanel` renders one
// (`Square`/`SquareCheck`, see lib/todos.ts). The `~~…~~` strikethrough that marks a todo done is
// real GFM (already parsed by Crepe's bundled `gfm` preset — no extra plugin needed here), so a
// closed todo's paragraph text reads identically to an open one; `done` is read off the
// `strike_through` mark on its content instead.
const TODO_PREFIX = /^@\/todo(?:\s|$)/;

// Same source-order filter `parseTodos` already applies line-by-line, kept local to this file: it's
// how a clicked paragraph (the Nth `@/todo` paragraph in the doc) is matched back to the Nth `@/todo`
// entry `parseTodos` finds in the raw text, so the click can rewrite that exact line. Legacy `- [ ]`
// lines render as Crepe's own task-list items (not a paragraph), so they never enter this count.
const commandTodoLines = (content: string) =>
  parseTodos(content).filter((t) => t.text.startsWith("@/todo") || t.text.startsWith("~~@/todo"));

const isDone = (node: ProseNode) =>
  node.childCount > 0 && node.child(0).marks.some((m) => m.type.name === "strike_through");

const checkboxWidget = (done: boolean, onClick: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = done ? "threadz-todo-check threadz-todo-check--done" : "threadz-todo-check";
  button.setAttribute("aria-label", done ? "Mark todo open" : "Mark todo done");
  button.setAttribute("contenteditable", "false");
  button.innerHTML = done
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
  button.addEventListener("mousedown", (e) => e.preventDefault()); // don't steal ProseMirror's selection
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return button;
};

// `prose`/`view` are the already-loaded `@milkdown/kit/prose/{state,view}` modules (MarkdownEditor.tsx
// loads both dynamically). `getValue`/`onToggle` are refs from that same React wrapper, read fresh on
// every click — the plugin itself is created once, at mount.
export const todoDecorationPlugin = (
  prose: ProseStateModule,
  view: ProseViewModule,
  opts: { getValue: () => string; onToggle: (nextMarkdown: string) => void },
) =>
  new prose.Plugin({
    key: new prose.PluginKey("threadz-todo-decoration"),
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        let index = 0;
        state.doc.forEach((node, offset) => {
          if (node.type.name !== "paragraph") return;
          const text = node.textContent.trim();
          if (!TODO_PREFIX.test(text)) return;
          const myIndex = index++;
          const done = isDone(node);
          const pos = offset + 1; // +1: inside the paragraph, before its first inline child
          decorations.push(
            view.Decoration.widget(
              pos,
              () =>
                checkboxWidget(done, () => {
                  const content = opts.getValue();
                  const todo = commandTodoLines(content)[myIndex];
                  if (!todo) return;
                  opts.onToggle(toggleTodoLine(content, todo.lineIndex));
                }),
              { side: -1, key: `todo-${myIndex}-${done}` },
            ),
          );
          decorations.push(view.Decoration.node(offset, offset + node.nodeSize, { class: "threadz-todo-line" }));
        });
        return view.DecorationSet.create(state.doc, decorations);
      },
    },
  });

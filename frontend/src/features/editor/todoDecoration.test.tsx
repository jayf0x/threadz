// Real render, real click — mounts the actual Crepe/Milkdown editor (not mocked, unlike
// EntryRow.test.tsx, which is specifically about *not* re-testing Milkdown's own mount) because
// this file's whole job is verifying that mount: the gutter checkbox for `@/todo` and for each
// `@/todos` item lands, reports the right line, and can't select the row underneath it. Same
// happy-dom registration boilerplate as EntryRow.test.tsx (see its own comment for why); duplicated
// here rather than imported since there's no shared test-setup helper yet (flagged there too).
import { Window } from "happy-dom";

const FORCE_OVERRIDE = new Set(["window", "document", "navigator", "location", "history"]);
const win = new Window({ url: "http://localhost/" }) as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis && !FORCE_OVERRIDE.has(key)) continue;
  (globalThis as Record<string, unknown>)[key] = win[key];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { expect, test } from "bun:test";
import { parseTodoGroups, parseTodos } from "@/lib/todos";

// Mirrors `features/threads/rowSelect.ts`'s `ROW_SELECT_IGNORE` constant, not imported — this file
// lives under `features/editor/`, and reaching into another feature's internals (rather than its
// `index.ts`, which doesn't export this) is exactly what AGENTS.md's import-boundary rule (and
// `noRestrictedImports` in biome.json) forbids, tests included. The production code
// (`./todoDecoration.ts`) keeps its own literal copy for the same reason.
const ROW_SELECT_IGNORE = "data-row-select-ignore";

const { fireEvent, render, waitFor } = await import("@testing-library/react");
const { MarkdownEditor } = await import("./MarkdownEditor");

const VALUE = ["@/todo write more docs", "", "@/todos Groceries", "- milk", "- [x] eggs"].join("\n");

// Sanity: the checkboxes below are expected to match these lineIndex/done pairs, straight off the
// same parser the plugin itself calls — if this ever drifts from VALUE above, the test's own
// expectations are wrong, not the plugin.
test("VALUE's own shape matches what the plugin is expected to render", () => {
  expect(parseTodos(VALUE)).toEqual([{ text: "@/todo write more docs", done: false, lineIndex: 0 }]);
  const { groups } = parseTodoGroups(VALUE);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.items).toEqual([
    { text: "milk", done: false, lineIndex: 3 },
    { text: "eggs", done: true, lineIndex: 4 },
  ]);
});

test("a `@/todo` line and every `@/todos` item get their own gutter checkbox, each toggleable and row-select-safe", async () => {
  const toggled: number[] = [];
  const { container } = render(
    <MarkdownEditor readOnly value={VALUE} onTodoToggle={(lineIndex) => toggled.push(lineIndex)} />,
  );

  const checkboxes = await waitFor(() => {
    const found = container.querySelectorAll(".threadz-todo-checkbox");
    expect(found.length).toBe(3); // the bare @/todo line + the group's two items — not the group's own title line
    return [...found] as HTMLButtonElement[];
  });

  // Every gutter checkbox must carry the row-select-ignore marker `rowSelect.ts`'s
  // `shouldSelectRow` looks for via `target.closest('[data-row-select-ignore]')` — otherwise
  // clicking it would also select/deselect the message row it's drawn over.
  for (const box of checkboxes) {
    expect(box.closest(`[${ROW_SELECT_IGNORE}]`)).toBe(box);
  }

  // Open/closed state renders straight off the parser (lineIndex 0 & 3 open, 4 done) — not a
  // guess at DOM order, so this also doubles as the "state isn't stale" check: these are read
  // fresh from `value` on every render, not cached in a ref.
  expect(checkboxes.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);

  fireEvent.click(checkboxes[0] as HTMLButtonElement); // the bare @/todo line
  fireEvent.click(checkboxes[2] as HTMLButtonElement); // "eggs", already done
  expect(toggled).toEqual([0, 4]);
});

test("the `@/todos` title line gets the highlight but no checkbox of its own", async () => {
  const { container } = render(<MarkdownEditor readOnly value={VALUE} onTodoToggle={() => {}} />);
  await waitFor(() => expect(container.querySelectorAll(".threadz-todo-checkbox").length).toBe(3));

  const lines = container.querySelectorAll(".threadz-todo-line");
  expect(lines.length).toBe(2); // the bare @/todo paragraph + the @/todos title paragraph
  const titleLine = [...lines].find((el) => el.textContent?.startsWith("@/todos"));
  expect(titleLine).toBeTruthy();
  expect(titleLine?.querySelector(".threadz-todo-checkbox")).toBeNull();
});

test("omitting onTodoToggle renders the highlight with no checkbox at all", async () => {
  const { container } = render(<MarkdownEditor readOnly value={VALUE} />);
  await waitFor(() => expect(container.querySelectorAll(".threadz-todo-line").length).toBe(2));
  expect(container.querySelectorAll(".threadz-todo-checkbox").length).toBe(0);
});

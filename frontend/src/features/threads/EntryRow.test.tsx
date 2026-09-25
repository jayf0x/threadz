// Empirical click-target discipline and edit-in-place wiring for `EntryRow` (EntryRow.tsx): a real render,
// real clicks — not just reasoning about `rowSelect.ts` (that's rowSelect.test.ts's job; this file checks
// the guard is actually wired onto the right elements in the real component). `@/features/editor`
// is mocked out (Milkdown/ProseMirror's own dynamic-import mount isn't what's under test here, and
// mounting a real one per AGENTS.md's dynamic-import setup is unnecessary weight for this check).
import { Window } from "happy-dom";

// A happy-dom Window carries every DOM constructor (Node, Element, every HTML*Element, …) *and* a
// full copy of the JS built-ins a browser's global scope also has (Promise, Object, Array, the
// timer functions, …). Only the former is missing from Bun's own globalThis and safe to add; the
// latter would shadow Bun's real ones and breaks its own internals (its stream machinery calls
// `setTimeout` expecting the one it started with). So: add whatever Bun doesn't already have, plus
// force the handful (`window`/`document`/`navigator`/`location`/`history`) Bun does define but only
// as stubs too thin for a real render. Registration is process-wide and never torn down, but no
// other suite touches `window`/`document`, so that's fine.
const FORCE_OVERRIDE = new Set(["window", "document", "navigator", "location", "history"]);
const win = new Window({ url: "http://localhost/" }) as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis && !FORCE_OVERRIDE.has(key)) continue;
  (globalThis as Record<string, unknown>)[key] = win[key];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { Message } from "@/lib/types";
import { ROW_SELECT_IGNORE } from "./rowSelect";

// The mocked `ContentField` stands in for the real editor: it publishes a handle whose dirtiness the test
// controls (`editor.dirty`), and renders the `trailing` slot only while editable, like the real one.
const editor = { dirty: false, entered: 0, exited: 0, text: "changed text" };
mock.module("@/features/editor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <div data-testid="md-content">{value}</div>,
  ContentField: ({
    value,
    readOnly,
    handleRef,
    trailing,
    onSubmit,
    onDirtyChange,
  }: {
    value: string;
    readOnly?: boolean;
    handleRef?: { current: unknown };
    trailing?: ReactNode;
    onSubmit?: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }) => {
    if (handleRef)
      handleRef.current = {
        getMarkdown: () => editor.text,
        isDirty: () => editor.dirty,
        enterEdit: () => editor.entered++,
        exitEdit: () => editor.exited++,
      };
    return (
      <div>
        <div data-testid="md-content">{value}</div>
        {!readOnly && (
          <>
            {trailing}
            <button type="button" onClick={() => onDirtyChange?.(true)}>
              type
            </button>
            <button type="button" onClick={() => onSubmit?.()}>
              submit
            </button>
          </>
        )}
      </div>
    );
  },
  ImageButton: () => <button type="button">image</button>,
  useImageAttach: () => ({ attach: async () => {}, error: null }),
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { EntryRow } = await import("./EntryRow");

afterEach(cleanup);

const message = (over: Partial<Message> = {}): Message => ({
  id: "m1",
  threadId: "t1",
  role: "user",
  content: "hello world",
  createdAt: Date.parse("2026-01-01T00:00:00Z"),
  seq: 1,
  meta: null,
  ...over,
});

const note = { id: "a1", threadId: "t1", messageId: "m1", content: "a note", createdAt: 1 };

const baseProps = () => ({
  pending: false,
  busy: false,
  isNew: false,
  selected: false,
  pulsing: false,
  onCopyThread: () => {},
  onSetTodo: () => {},
  note: undefined,
  unsyncedAnnotations: new Set<string>(),
  onAddAnnotation: async () => true,
  onEditAnnotation: async () => true,
  onDeleteAnnotation: async () => true,
  onNavigateReference: () => {},
});

test("clicking the plain message content selects the row", () => {
  let selectCount = 0;
  const { getByTestId } = render(
    <EntryRow message={message()} {...baseProps()} onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  fireEvent.click(getByTestId("md-content"));
  expect(selectCount).toBe(1);
});

test("the actions row's buttons and ⋯ trigger do not select the row", () => {
  let selectCount = 0;
  const todos: (boolean | null)[] = [];
  const { getByLabelText } = render(
    <EntryRow
      message={message()}
      {...baseProps()}
      selected
      onSetTodo={(d) => todos.push(d)}
      onEdit={async () => true}
      onSelect={() => selectCount++}
    />,
  );
  fireEvent.click(getByLabelText("Message actions"));
  fireEvent.click(getByLabelText("Todo"));
  expect(todos).toEqual([false]);
  expect(selectCount).toBe(0);
});

test("the Todo toggle reports its state and clears a set flag", () => {
  const todos: (boolean | null)[] = [];
  const { getByLabelText } = render(
    <EntryRow
      message={message({ meta: { todo: { done: false } } })}
      {...baseProps()}
      selected
      onSetTodo={(d) => todos.push(d)}
      onEdit={async () => true}
      onSelect={() => {}}
    />,
  );
  expect(getByLabelText("Todo").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(getByLabelText("Todo"));
  expect(todos).toEqual([null]);
});

test("the note chip opens the note without selecting the row, and clicks inside the overlay don't select either", async () => {
  let selectCount = 0;
  const { getByTitle } = render(
    <EntryRow
      message={message()}
      {...baseProps()}
      note={note}
      onEdit={async () => true}
      onSelect={() => selectCount++}
    />,
  );
  // Radix positions/animates in a later microtask: settling it inside `act` avoids the act warning.
  await act(async () => {
    fireEvent.click(getByTitle("Note"));
  });
  expect(selectCount).toBe(0);
  const overlay = document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]");
  expect(overlay).toBeTruthy(); // it did open
  await act(async () => {
    fireEvent.click(overlay?.querySelector("time") as Element); // React bubbles portal clicks through the row
  });
  expect(selectCount).toBe(0);
});

test("Add note (only when there is no note) opens the overlay in compose mode", async () => {
  const { getByLabelText } = render(
    <EntryRow message={message()} {...baseProps()} selected onEdit={async () => true} onSelect={() => {}} />,
  );
  await act(async () => {
    fireEvent.click(getByLabelText("Add note"));
  });
  expect(document.querySelector("[role=dialog], [data-radix-popper-content-wrapper]")).toBeTruthy();
  expect(document.querySelector("[aria-label='Save note']")).toBeTruthy(); // the note editor, not a read view
});

test("an unselected message shows no metadata, no actions and — with no note — no note chip", () => {
  const edited = message({
    edits: [{ content: "older text", at: Date.parse("2025-01-01T00:00:00Z") }],
    meta: { voice: true },
  });
  const { container, queryByLabelText, queryByText, queryByTitle } = render(
    <EntryRow message={edited} {...baseProps()} pending onEdit={async () => true} onSelect={() => {}} />,
  );
  expect(queryByLabelText("Message actions")).toBeNull();
  expect(queryByLabelText("Edit")).toBeNull();
  expect(queryByLabelText("Add note")).toBeNull();
  expect(queryByTitle("Note")).toBeNull();
  expect(queryByText("edited")).toBeNull();
  expect(container.querySelector("time")).toBeNull();
  expect(container.querySelector(`[${ROW_SELECT_IGNORE}]`)).toBeNull();
});

test("a note shows its chip even while the message is not selected, and hides Add note once there is one", () => {
  const { getByTitle, queryByLabelText } = render(
    <EntryRow
      message={message()}
      {...baseProps()}
      note={note}
      selected
      onEdit={async () => true}
      onSelect={() => {}}
    />,
  );
  expect(getByTitle("Note").textContent).toContain("a note");
  expect(queryByLabelText("Add note")).toBeNull();
});

test("an assistant message gets ⋯ but no Edit, Todo or Add note", () => {
  const { getByLabelText, queryByLabelText } = render(
    <EntryRow
      message={message({ role: "assistant" })}
      {...baseProps()}
      selected
      onEdit={async () => true}
      onSelect={() => {}}
    />,
  );
  expect(getByLabelText("Message actions")).toBeTruthy();
  expect(queryByLabelText("Edit")).toBeNull();
  expect(queryByLabelText("Todo")).toBeNull();
  expect(queryByLabelText("Add note")).toBeNull();
});

test("clicking the 'edited' history toggle does not select the row", () => {
  let selectCount = 0;
  const edited = message({ edits: [{ content: "older text", at: Date.parse("2025-01-01T00:00:00Z") }] });
  const { getByText } = render(
    <EntryRow message={edited} {...baseProps()} selected onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  fireEvent.click(getByText("edited"));
  expect(selectCount).toBe(0);
});

test("clicking the actions row itself (not just its buttons) does not select either", () => {
  // The whole row is one ignore zone (rowSelect.ts), not just the individual buttons in it.
  let selectCount = 0;
  const { container } = render(
    <EntryRow message={message()} {...baseProps()} selected onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  const bar = container.querySelector(`[${ROW_SELECT_IGNORE}]`);
  expect(bar).toBeTruthy();
  fireEvent.click(bar as Element);
  expect(selectCount).toBe(0);
});

test("selected and pulsing map to the persistent-selection and arrival-pulse CSS classes", () => {
  const { container: plain } = render(
    <EntryRow message={message()} {...baseProps()} onEdit={async () => true} onSelect={() => {}} />,
  );
  const plainArticle = plain.querySelector("article") as HTMLElement;
  expect(plainArticle.className).not.toContain("message-selected");
  expect(plainArticle.className).not.toContain("message-pulse");

  const { container: sel } = render(
    <EntryRow message={message()} {...baseProps()} selected pulsing onEdit={async () => true} onSelect={() => {}} />,
  );
  const selArticle = sel.querySelector("article") as HTMLElement;
  expect(selArticle.className).toContain("message-selected");
  expect(selArticle.className).toContain("message-pulse");
});

test("edit in place: Edit enters the same editor, Save waits for a real change, an untouched message never saves", async () => {
  Object.assign(editor, { dirty: false, entered: 0, exited: 0 });
  const edits: string[] = [];
  const { getByLabelText, getByText } = render(
    <EntryRow
      message={message()}
      {...baseProps()}
      selected
      onEdit={async (t) => {
        edits.push(t);
        return true;
      }}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(getByLabelText("Edit"));
  expect(editor.entered).toBe(1); // called inside the tap, before any state settles

  // Untouched: Save is disabled, and the ⌘Enter path (`onSubmit`) also refuses.
  expect((getByLabelText("Save") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    fireEvent.click(getByText("submit"));
  });
  expect(edits).toEqual([]);

  // Typing makes it dirty: Save enables and persists the editor's own markdown.
  editor.dirty = true;
  fireEvent.click(getByText("type"));
  expect((getByLabelText("Save") as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    fireEvent.click(getByLabelText("Save"));
  });
  expect(edits).toEqual(["changed text"]);
  expect(editor.exited).toBe(1);
});

test("Cancel discards through the editor and leaves without saving", () => {
  Object.assign(editor, { dirty: true, entered: 0, exited: 0 });
  const edits: string[] = [];
  const { getByLabelText } = render(
    <EntryRow
      message={message()}
      {...baseProps()}
      selected
      onEdit={async (t) => {
        edits.push(t);
        return true;
      }}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(getByLabelText("Edit"));
  fireEvent.click(getByLabelText("Cancel"));
  expect(editor.exited).toBe(1);
  expect(edits).toEqual([]);
});

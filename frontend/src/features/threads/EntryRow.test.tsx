// Empirical click-target discipline for `EntryRow` (ThreadView.tsx): a real render, real clicks —
// not just reasoning about `rowSelect.ts`'s guard (that's rowSelect.test.ts's job; this file checks
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

import { expect, mock, test } from "bun:test";
import type { Message } from "@/lib/types";
import { ROW_SELECT_IGNORE } from "./rowSelect";

mock.module("@/features/editor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <div data-testid="md-content">{value}</div>,
  ImageButton: () => <button type="button">image</button>,
  useImageAttach: () => ({ attach: async () => {}, error: null }),
}));

const { fireEvent, render } = await import("@testing-library/react");
const { EntryRow } = await import("./ThreadView");

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

test("clicking the ⋯ message-actions trigger does not select the row", () => {
  let selectCount = 0;
  const { getByLabelText } = render(
    <EntryRow message={message()} {...baseProps()} onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  fireEvent.click(getByLabelText("Message actions"));
  expect(selectCount).toBe(0);
});

test("clicking the note trigger does not select the row", () => {
  let selectCount = 0;
  const { getByLabelText } = render(
    <EntryRow message={message()} {...baseProps()} onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  fireEvent.click(getByLabelText("Add a note"));
  expect(selectCount).toBe(0);
});

test("clicking the 'edited' history toggle does not select the row", () => {
  let selectCount = 0;
  const edited = message({ edits: [{ content: "older text", at: Date.parse("2025-01-01T00:00:00Z") }] });
  const { getByText } = render(
    <EntryRow message={edited} {...baseProps()} onEdit={async () => true} onSelect={() => selectCount++} />,
  );
  fireEvent.click(getByText("edited"));
  expect(selectCount).toBe(0);
});

test("clicking the metadata bar itself (not just its buttons) does not select either", () => {
  // The whole bar is one ignore zone (rowSelect.ts), not just the individual buttons in it.
  let selectCount = 0;
  const { container } = render(
    <EntryRow message={message()} {...baseProps()} onEdit={async () => true} onSelect={() => selectCount++} />,
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

// The edit-in-place contract on a real, mounted Crepe view: one instance goes read-only -> editing ->
// read-only through the handle, with the dirty baseline taken from the editor's own serialiser (so an
// untouched old message with `* item` markdown isn't "changed"). Typing itself can't run under
// happy-dom, so an edit is a `setMarkdown`. Same happy-dom boilerplate as `todoDecoration.test.tsx`.
import { Window } from "happy-dom";

const FORCE_OVERRIDE = new Set(["window", "document", "navigator", "location", "history"]);
const win = new Window({ url: "http://localhost/" }) as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis && !FORCE_OVERRIDE.has(key)) continue;
  (globalThis as Record<string, unknown>)[key] = win[key];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from "bun:test";
import { createRef } from "react";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { ContentField } = await import("./ContentField");
type Handle = import("./MarkdownEditor").MarkdownEditorHandle;

afterEach(cleanup);

const editable = (container: HTMLElement) => container.querySelector(".ProseMirror")?.getAttribute("contenteditable");

test("enterEdit makes the same instance editable, an untouched message is clean, an edit is dirty, cancel restores", async () => {
  const handle = createRef<Handle>();
  const stored = "* one\n* two_snake";
  const { container } = render(<ContentField variant="edit" readOnly value={stored} handleRef={handle} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
  expect(editable(container)).toBe("false");
  expect(handle.current?.isDirty()).toBe(false); // not editing: nothing to be dirty against

  act(() => handle.current?.enterEdit());
  expect(editable(container)).toBe("true");
  // The editor re-serialises (`*` -> `-`, `_` escaped), yet the untouched text is not "changed".
  expect(handle.current?.getMarkdown()).not.toBe(stored);
  expect(handle.current?.isDirty()).toBe(false);

  act(() => handle.current?.setMarkdown("- one\n- two changed"));
  expect(handle.current?.isDirty()).toBe(true);

  act(() => handle.current?.exitEdit(true));
  expect(editable(container)).toBe("false");
  expect(handle.current?.isDirty()).toBe(false);
  expect(handle.current?.getMarkdown()).toContain("two");
  expect(handle.current?.getMarkdown()).not.toContain("changed");
});

test("the read view carries no surface or action row; editing adds them", async () => {
  const { container, rerender } = render(
    <ContentField variant="edit" readOnly value="hello" trailing={<button type="button">save</button>} />,
  );
  await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector(".content-field")?.className).toContain("border-transparent");

  rerender(<ContentField variant="edit" value="hello" trailing={<button type="button">save</button>} />);
  expect(container.querySelector("button")?.textContent).toBe("save");
  expect(container.querySelector(".content-field")?.className).not.toContain("border-transparent");
});

// Real end-to-end coverage for References : type the `[[` trigger, let
// the live autocomplete complete a thread and then a message inside it, and click the resulting
// rendered link to navigate — the one item in this groundwork slice explicitly called out as
// needing more than a unit test. Real render, real typing, real Crepe mount for the click half (not
// mocked, unlike EntryRow.test.tsx — this file's whole job is verifying the actual wiring), and a
// real `threadz-local` IndexedDB (`fake-indexeddb`, same convention as `lib/local.test.ts`) so the
// autocomplete has real local-only data to search (decision 4). Same happy-dom registration
// boilerplate as `todoDecoration.test.tsx`/`EntryRow.test.tsx` — duplicated rather than shared, see
// their own comments for why there's no test-setup helper yet.
//
// Needs `bun test --isolate` (already the `test`/`check` scripts' default — see package.json):
// without it, this file's `window`/`document` and `fake-indexeddb`'s globals share one process-wide
// `globalThis` with every OTHER happy-dom test file bun runs alongside it, and whichever one last
// touched `indexedDB`/`window` — including mid-run, interleaved with this file's own `waitFor`
// polling — wins. `--isolate` gives each test file its own fresh global object instead.
import "fake-indexeddb/auto";
import { Window } from "happy-dom";

const FORCE_OVERRIDE = new Set(["window", "document", "navigator", "location", "history"]);
const win = new Window({ url: "http://localhost/" }) as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis && !FORCE_OVERRIDE.has(key)) continue;
  (globalThis as Record<string, unknown>)[key] = win[key];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { localApi } from "@/lib/local";

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { MarkdownEditor } = await import("./MarkdownEditor");

afterEach(cleanup);

afterEach(cleanup);

// A minimal stand-in for how the app actually uses this: type in a raw-mode editor (message inline
// edit / note popover's own surface — see MarkdownEditor.tsx's RawEditor), same as the composer/edit
// surfaces the autocomplete is wired into, then show the result the way a saved message actually
// renders (readOnly — always the live Crepe view, per AGENTS.md's "Custom rendering inside the
// Milkdown view").
const Harness = ({ onNavigate }: { onNavigate: (threadId: string, messageId: string | null) => void }) => {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <MarkdownEditor raw value={draft} onChange={setDraft} />
      <button type="button" onClick={() => setSaved(draft)}>
        save
      </button>
      {saved != null && <MarkdownEditor readOnly value={saved} onReferenceClick={onNavigate} />}
    </>
  );
};

// Types `text` by replacing the textarea's whole value (append-only, matching how these tests only
// ever type forward) and explicitly parking the caret at the end — `fireEvent.change` alone doesn't
// reliably leave `selectionStart` where a real keystroke would under happy-dom, and RawEditor's
// autocomplete wiring reads the caret from the DOM element itself, not from the value.
const type = (textarea: HTMLTextAreaElement, text: string) => {
  fireEvent.change(textarea, { target: { value: text } });
  textarea.setSelectionRange(text.length, text.length);
};

test("type a reference, autocomplete it through both stages, click it, land on the right thread and message", async () => {
  const thread = await localApi.createThread({ title: "Groceries" });
  const { message } = await localApi.appendMessage(thread.id, { id: crypto.randomUUID(), content: "buy oat milk" });
  await localApi.createThread({ title: "Unrelated thread" }); // a distractor the query below must not match

  const navigated: { threadId: string; messageId: string | null }[] = [];
  const { container } = render(
    <Harness onNavigate={(threadId, messageId) => navigated.push({ threadId, messageId })} />,
  );
  const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
  expect(textarea).toBeTruthy();

  // Stage 1: the trigger opens a live thread search.
  type(textarea, "see [[Groc");
  const threadOption = await screen.findByText("Groceries");
  fireEvent.mouseDown(threadOption); // ReferenceAutocompleteMenu accepts on mousedown (keeps focus in the field)

  // Tab/Enter's job (completeThread) already ran: a real, already-closed markdown link — no forced
  // message id yet, so Esc/outside-click right here would already leave a valid thread-only reference.
  await waitFor(() => expect(textarea.value).toBe(`see [Groceries](thread=${thread.id})`));

  // Stage 2: continues straight into that thread's own messages.
  type(textarea, `${textarea.value} milk`);
  const messageOption = await screen.findByText("buy oat milk");
  fireEvent.mouseDown(messageOption);

  const completed = `see [Groceries](thread=${thread.id}?message=${message.id})`;
  await waitFor(() => expect(textarea.value).toBe(completed));

  // Render the completed reference the way a saved message actually shows it (readOnly, live Crepe
  // view) and click it.
  fireEvent.click(screen.getByText("save"));
  const link = await screen.findByRole("link", { name: "Groceries" });
  expect(link.getAttribute("href")).toBe(`thread=${thread.id}?message=${message.id}`);

  fireEvent.click(link);
  expect(navigated).toEqual([{ threadId: thread.id, messageId: message.id }]);
});

test("Esc right after completing the thread stage cancels the autocomplete but leaves the thread-only reference behind", async () => {
  // A distinct title from the other test's threads — this file's tests share one fake-indexeddb
  // instance (module-level, like `lib/local.test.ts`), so a duplicate "Groceries" would make the
  // dropdown's match ambiguous.
  await localApi.createThread({ title: "Widgets" });

  const { container } = render(<Harness onNavigate={() => {}} />);
  const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

  type(textarea, "[[Widg");
  const threadOption = await screen.findByText("Widgets");
  fireEvent.mouseDown(threadOption);
  await waitFor(() => expect(textarea.value).toMatch(/^\[Widgets\]\(thread=.+\)$/));
  const completedThreadOnly = textarea.value;

  // Now mid-stage-two: typing a query for a message, then bailing out with Esc.
  type(textarea, `${textarea.value} oat`);
  await screen.findByText(/No matching messages|buy/); // the message-stage popup is open

  fireEvent.keyDown(textarea, { key: "Escape" });

  // The dropdown is gone, and — critically — nothing forced a message id onto the reference: the
  // thread-only link is untouched. The " oat" the user typed while searching is left exactly as
  // typed too (Esc never deletes text, see lib/references.ts's nextAutocompleteState comment).
  expect(textarea.value).toBe(`${completedThreadOnly} oat`);
  expect(screen.queryByText(/No matching messages|buy oat/)).toBeNull();
});

test("after a first message pick the same popup offers a range end; picking it writes a from..to link that navigates as one string", async () => {
  const thread = await localApi.createThread({ title: "Recipes" });
  const first = (await localApi.appendMessage(thread.id, { id: crypto.randomUUID(), content: "step one chop" }))
    .message;
  await localApi.appendMessage(thread.id, { id: crypto.randomUUID(), content: "step two boil" });
  const last = (await localApi.appendMessage(thread.id, { id: crypto.randomUUID(), content: "step three serve" }))
    .message;

  const navigated: { threadId: string; messageId: string | null }[] = [];
  const { container } = render(
    <Harness onNavigate={(threadId, messageId) => navigated.push({ threadId, messageId })} />,
  );
  const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

  type(textarea, "[[Recip");
  fireEvent.mouseDown(await screen.findByText("Recipes"));
  await waitFor(() => expect(textarea.value).toBe(`[Recipes](thread=${thread.id})`));

  type(textarea, `${textarea.value} chop`);
  fireEvent.mouseDown(await screen.findByText("step one chop"));
  await waitFor(() => expect(textarea.value).toBe(`[Recipes](thread=${thread.id}?message=${first.id})`));

  // Still open, now for the range's end.
  fireEvent.mouseDown(await screen.findByText("step three serve"));
  const ranged = `[Recipes](thread=${thread.id}?message=${first.id}..${last.id})`;
  await waitFor(() => expect(textarea.value).toBe(ranged));
  expect(screen.queryByText("step three serve")).toBeNull(); // closed after the second pick

  fireEvent.click(screen.getByText("save"));
  const link = await screen.findByRole("link", { name: "Recipes" });
  expect(link.getAttribute("href")).toBe(`thread=${thread.id}?message=${first.id}..${last.id}`);
  fireEvent.click(link);
  expect(navigated).toEqual([{ threadId: thread.id, messageId: `${first.id}..${last.id}` }]);
});

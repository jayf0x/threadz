import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { ROW_SELECT_IGNORE, shouldSelectRow } from "./rowSelect";

// Plain DOM, no React: `shouldSelectRow` only ever needs an Element and a boolean, so a headless
// happy-dom document (not registered globally — this file doesn't need `window`/`document` to
// exist anywhere else) is enough to build the shapes a real row can put a click through. happy-dom's
// `Element` is structurally close enough to lib.dom's (it's what a real click's `e.target` is at
// runtime here) but not identical, hence the `unknown` hop instead of a direct assertion.
const doc = new Window().document;

const el = (html: string) => {
  const div = doc.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild as unknown as Element;
};

test("a plain click target (the message text) selects", () => {
  const row = el(`<div><p>hello</p></div>`);
  const text = row.querySelector("p") as Element;
  expect(shouldSelectRow(text, false)).toBe(true);
});

test("a click inside a row-select-ignore zone (the ⋯ menu, note trigger, edited toggle) does not select", () => {
  const row = el(`
    <div>
      <p ${ROW_SELECT_IGNORE}="">
        <button data-testid="edited">edited</button>
        <button data-testid="note">note</button>
        <button data-testid="menu">⋯</button>
      </p>
    </div>
  `);
  for (const testid of ["edited", "note", "menu"]) {
    const btn = row.querySelector(`[data-testid="${testid}"]`) as Element;
    expect(shouldSelectRow(btn, false)).toBe(false);
  }
});

test("the ignore zone itself (not just its buttons) does not select — clicking its padding is still 'the bar'", () => {
  const row = el(`<div><p ${ROW_SELECT_IGNORE}="">text between icons</p></div>`);
  const bar = row.querySelector("p") as Element;
  expect(shouldSelectRow(bar, false)).toBe(false);
});

test("editing mode never selects, regardless of target — the row is a live editor, not a message to pick", () => {
  const row = el(`<div><div class="editor">typing…</div></div>`);
  const editor = row.querySelector(".editor") as Element;
  expect(shouldSelectRow(editor, true)).toBe(false);
  // Even a target that would otherwise be perfectly selectable (no ignore zone) is blocked by `editing`.
  expect(shouldSelectRow(row, true)).toBe(false);
});

test("a nested click deep inside an ignore zone still resolves via closest(), not just a direct hit", () => {
  const row = el(`<div><p ${ROW_SELECT_IGNORE}=""><span><svg><path /></svg></span></p></div>`);
  const path = row.querySelector("path") as Element;
  expect(shouldSelectRow(path, false)).toBe(false);
});

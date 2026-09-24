// Click-target discipline for `EntryRow`'s row-select handler (ThreadView.tsx): a message row
// selects on click, but the row also hosts the ⋯ menu trigger, the note-popover trigger, and the
// "edited" history toggle — none of those (nor anything in edit mode, where the row is a live
// editor instead) should select the row out from under the click they're handling. Pure and
// DOM-only so it's testable without mounting React/Milkdown — see rowSelect.test.ts.

/** Any click inside an element carrying this reaches `shouldSelectRow` and is told not to select.
 * Wrap a zone once (the metadata bar's ⋯ menu / note trigger / edited toggle all live under one),
 * rather than marking every individual button. */
export const ROW_SELECT_IGNORE = "data-row-select-ignore";

/** Radix renders menus and popovers in a portal, but React still bubbles their clicks up through the
 * row that owns them — so they're recognised by Radix's own wrapper attribute, not by being inside
 * the row's DOM. (Picking a menu item must not toggle the row's selection.) */
const PORTAL = "[data-radix-popper-content-wrapper]";

/** Whether a click on `target` should select the row it's in. `editing` covers edit mode wholesale
 * (a live editor, its Cancel/Save buttons) without needing to mark up every element inside it. */
export const shouldSelectRow = (target: Element, editing: boolean): boolean => {
  if (editing) return false;
  return !target.closest(`[${ROW_SELECT_IGNORE}], ${PORTAL}`);
};

/** True when a global shortcut should stand down: the keypress is landing in a field, or a modal dialog is open. */
export const shortcutBlocked = (e: KeyboardEvent): boolean =>
  document.querySelector("dialog[open]") !== null ||
  (e.target instanceof HTMLElement &&
    (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)));

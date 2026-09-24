/** True when a global shortcut should stand down: the keypress is landing in a field, or a modal dialog is open. */
export const shortcutBlocked = (e: KeyboardEvent): boolean =>
  document.querySelector("dialog[open]") !== null ||
  (e.target instanceof HTMLElement &&
    (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)));

/** A touch-first device (finger, no hover/keyboard shortcuts). Gates hints like "press n" that only
 * make sense with a keyboard, and defaults like Lock zoom. */
export const isTouch = (): boolean => window.matchMedia?.("(pointer: coarse)").matches ?? false;

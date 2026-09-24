/** A native modal `<dialog>` (ConnectionDialog) or a Radix menu/popover is open. */
const layerOpen = (): boolean => document.querySelector("dialog[open], [data-radix-popper-content-wrapper]") !== null;

/** True when a bare-key global shortcut should stand down: the keypress is landing in a field, or a
 * layer is open. Esc dismissing a Radix menu/popover must not also close the thread behind it, so
 * callers listen in the capture phase — before Radix's own document-level handler has removed the layer. */
export const shortcutBlocked = (e: KeyboardEvent): boolean =>
  layerOpen() ||
  (e.target instanceof HTMLElement &&
    (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)));

/** For modifier shortcuts (⌘K): fine to fire from inside a field, only an open layer stands in the way. */
export const chordBlocked = (): boolean => layerOpen();

/** A touch-first device (finger, no hover/keyboard shortcuts). Gates hints like "press n" that only
 * make sense with a keyboard, and defaults like Lock zoom. */
export const isTouch = (): boolean => window.matchMedia?.("(pointer: coarse)").matches ?? false;

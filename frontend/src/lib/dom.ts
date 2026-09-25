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

/** Nudge the nearest `.overflow-y-auto` ancestor so `el` is fully visible. Sets `scrollTop` directly — never
 * `scrollIntoView`, which also scrolls iOS's visual viewport and shoves the whole layout. */
export const revealInScroller = (el: HTMLElement) => {
  const scroller = el.closest<HTMLElement>(".overflow-y-auto");
  if (!scroller) return;
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.bottom > s.bottom - 8) scroller.scrollTop += r.bottom - s.bottom + 8;
  if (r.top < s.top + 8) scroller.scrollTop -= s.top - r.top + 8;
};

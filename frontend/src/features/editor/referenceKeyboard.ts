// Keydown handling for the reference autocomplete popover (used by `MarkdownEditor.tsx`): the key
// contract (Tab/Enter accepts, Esc cancels, arrows move the highlight) is defined once. Framework/DOM
// agnostic beyond a plain `{ key, preventDefault, stopPropagation }` shape both a React
// `KeyboardEvent` and a native one satisfy.
type KeyLike = { key: string; preventDefault: () => void; stopPropagation: () => void };

/** Returns whether the key was consumed by the autocomplete — the caller's own `onKeyDownCapture`
 * (⌘Enter to send, Esc to cancel an edit, …) only runs when this returns `false`, exactly like the
 * one already documented on `MarkdownEditor`'s own prop: "a caller can claim a chord… runs before
 * ProseMirror's own handlers." Reads `options`/`highlighted` fresh from the caller on every call
 * (never cached) so a keystroke always acts on whatever's actually on screen right now. */
export const handleReferenceKeyDown = (
  e: KeyLike,
  open: boolean,
  optionCount: number,
  highlighted: number,
  setHighlighted: (updater: (h: number) => number) => void,
  accept: (index: number) => void,
  cancel: () => void,
): boolean => {
  if (!open) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancel();
    return true;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    setHighlighted((h) => Math.min(h + 1, Math.max(0, optionCount - 1)));
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    setHighlighted((h) => Math.max(h - 1, 0));
    return true;
  }
  if ((e.key === "Tab" || e.key === "Enter") && optionCount > 0) {
    e.preventDefault();
    e.stopPropagation();
    accept(Math.min(highlighted, optionCount - 1));
    return true;
  }
  return false;
};

/** Busy = a writable editor (composer, message or note being edited) holds text. Read-only editors
 * are `contenteditable="false"`, so this catches unsent composer text and an open edit without
 * every editor having to register itself. */
export const isBusy = (root: ParentNode = document): boolean => {
  for (const el of root.querySelectorAll('.ProseMirror[contenteditable="true"]')) {
    if (el.textContent?.trim()) return true;
  }
  return false;
};

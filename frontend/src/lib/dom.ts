/** True when a keypress is landing in a field, so global shortcuts must stay out of its way. */
export const isTypingTarget = (e: KeyboardEvent): boolean =>
  e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

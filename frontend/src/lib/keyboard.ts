// iOS raises the on-screen keyboard only for a focus() made synchronously inside a tap. A field that takes
// focus a moment later (an editor that finishes mounting inside a sheet) gets a caret but no keyboard.
// A throwaway input focused *inside the tap* holds the keyboard up; the real field takes focus from it
// when it's ready and calls `releaseKeyboard()` (removing a focused element first would drop the keyboard).
// Harmless elsewhere: it's invisible, 16px (no iOS zoom) and removes itself after a beat regardless.
let proxy: HTMLInputElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export const releaseKeyboard = () => {
  clearTimeout(timer);
  proxy?.remove();
  proxy = null;
};

export const holdKeyboard = () => {
  if (proxy || typeof document === "undefined") return;
  const el = document.createElement("input");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none";
  document.body.append(el);
  el.focus({ preventScroll: true });
  proxy = el;
  timer = setTimeout(releaseKeyboard, 1500);
};

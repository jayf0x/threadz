// Keeps the app's box equal to what's actually visible. iOS doesn't shrink the layout viewport for
// the keyboard — it overlays it and *pans the visual viewport* to reveal the focused field, so a
// `100dvh` shell slides up under the status bar and the header/list go missing (the "overflow" that
// depended on scroll position and keyboard timing). The shell sizes and positions itself from
// `--vv-h` / `--vv-top` instead (App.tsx), re-synced on every visualViewport `resize` and `scroll`:
// the keyboard animates through several of both.
//
// `data-keyboard` on <html> lets CSS give the space back while it's up (no home-indicator padding,
// a shorter composer) — see styles.css.
const KEYBOARD_MIN_PX = 120;

export const trackViewport = () => {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let full = 0; // tallest the visible area has been at this width = "no keyboard"
  let width = 0;

  const sync = () => {
    if (vv.scale > 1.01) return; // pinch-zoomed (Lock zoom off): leave layout to the browser
    if (window.innerWidth !== width) {
      width = window.innerWidth; // rotated / resized: the old baseline no longer applies
      full = 0;
    }
    full = Math.max(full, window.innerHeight, vv.height);
    root.style.setProperty("--vv-h", `${vv.height}px`);
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.toggleAttribute("data-keyboard", full - vv.height > KEYBOARD_MIN_PX);
  };

  // iOS 26 can leave `offsetTop` stale after the keyboard closes (no final scroll/resize event), so
  // re-read on blur, when the page comes back from the background, and on a short delayed tick.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const settle = () => {
    sync();
    for (const ms of [100, 300, 600]) {
      const t = setTimeout(() => {
        timers.delete(t);
        sync();
      }, ms);
      timers.add(t);
    }
  };
  const onFocusOut = () => {
    settle();
    const t = setTimeout(() => {
      timers.delete(t);
      const a = document.activeElement;
      const editing = a instanceof HTMLElement && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
      if (!editing && vv.offsetTop !== 0) window.scrollTo(0, 0);
      sync();
    }, 350);
    timers.add(t);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") settle();
  };

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  window.addEventListener("focusout", onFocusOut);
  window.addEventListener("pageshow", settle);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    window.removeEventListener("resize", sync);
    window.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("pageshow", settle);
    document.removeEventListener("visibilitychange", onVisible);
    for (const t of timers) clearTimeout(t);
  };
};

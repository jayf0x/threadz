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

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
  };
};

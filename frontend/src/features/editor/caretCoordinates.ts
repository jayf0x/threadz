// Pixel position of a caret index inside a plain `<textarea>`, for anchoring the reference
// autocomplete popover (`ReferenceAutocompleteMenu.tsx`) to the caret it's actually completing,
// not just some corner of the box. A `<textarea>` has no API for this (unlike ProseMirror's
// `view.coordsAtPos`, which the WYSIWYG adapter uses instead — see `MarkdownEditor.tsx`'s
// `CrepeEditor`), so this is the standard "mirror div" technique: clone the textarea's
// box/font/whitespace-relevant computed styles into a hidden absolutely-positioned div, insert a
// marker span at the target index, and measure the marker. No dependency for this (the app has no
// other need for it) — imperfect at extreme zoom/font edge cases, good enough for anchoring a
// popover that Radix then flips/shifts to stay on screen regardless.
const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "wordSpacing",
  "tabSize",
] as const;

/** Viewport-relative rect (same coordinate space as `getBoundingClientRect`/`coordsAtPos`) of the
 * character at `index` in `el`'s current value. */
export const caretRect = (el: HTMLTextAreaElement, index: number): DOMRect => {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  for (const prop of MIRRORED_PROPERTIES) mirror.style[prop] = style[prop];

  mirror.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(index, index + 1) || ".";
  mirror.append(marker);
  document.body.append(mirror);

  const elBox = el.getBoundingClientRect();
  const markerBox = marker.getBoundingClientRect();
  const mirrorBox = mirror.getBoundingClientRect();
  const rect = new DOMRect(
    elBox.left + (markerBox.left - mirrorBox.left) - el.scrollLeft,
    elBox.top + (markerBox.top - mirrorBox.top) - el.scrollTop,
    1,
    markerBox.height || Number.parseFloat(style.lineHeight) || 16,
  );
  mirror.remove();
  return rect;
};

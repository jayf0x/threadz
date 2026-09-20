import type { Node } from "@milkdown/kit/prose/model";
import { resolveImage } from "@/lib/imageSync";
import { parseRef } from "@/lib/images";

// How an `image` node is drawn. `img:` refs get a grey box of the right aspect ratio; the bytes
// are only looked up once it scrolls near the viewport, and the object URL is revoked with the node.
// Anything else (a plain https image) is left to the browser.
export const imageView = (node: Node) => {
  const src = String(node.attrs.src);
  const ref = parseRef(src);
  if (!ref) return { dom: Object.assign(document.createElement("img"), { src, alt: node.attrs.alt }) };

  const box = document.createElement("span");
  box.className = "threadz-img";
  box.style.aspectRatio = ref.w && ref.h ? `${ref.w} / ${ref.h}` : "4 / 3";
  if (ref.w) box.style.width = `min(${ref.w}px, 100%)`;

  let url: string | null = null;
  let gone = false;
  const seen = new IntersectionObserver(
    ([e]) => {
      if (!e?.isIntersecting) return;
      seen.disconnect();
      resolveImage(ref.hash).then((u) => {
        if (!u) return; // not on this device (and main is out of reach): stays a grey box
        if (gone) return URL.revokeObjectURL(u);
        url = u;
        box.append(Object.assign(document.createElement("img"), { src: u, alt: node.attrs.alt }));
      });
    },
    { rootMargin: "300px" },
  );
  seen.observe(box);

  return {
    dom: box,
    destroy: () => {
      gone = true;
      seen.disconnect();
      if (url) URL.revokeObjectURL(url);
    },
  };
};

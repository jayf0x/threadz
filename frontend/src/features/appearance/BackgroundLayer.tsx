import { useBackgroundImageUrl } from "@/lib/backgroundImage";
import { useSettings } from "@/lib/settings";
import { DEFAULT_BACKGROUND_GRADIENT } from "./gradients";

// The device's wallpaper: one fixed layer behind the whole app (z-0 — App.tsx's Shell stacks
// above it at z-10). Same setting for every thread, same in Local and Live: it's pure device
// state (lib/settings.ts + lib/backgroundImage.ts), so neither mode needs to know it exists.
// The default is a faint wash; an image is drawn at full strength — how much of it you see is decided
// by how opaque the panes on top are (lib/settings.ts's `paneAlpha`, the opacity slider), not by fading
// the image itself.
export const BackgroundLayer = () => {
  const { background } = useSettings();
  const url = useBackgroundImageUrl(background.type === "image");

  if (background.type === "image" && !url) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
      style={
        background.type === "image"
          ? { backgroundImage: `url(${url})` }
          : { backgroundImage: DEFAULT_BACKGROUND_GRADIENT, opacity: 0.1 }
      }
    />
  );
};

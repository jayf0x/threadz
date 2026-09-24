import { useBackgroundImageUrl } from "@/lib/backgroundImage";
import { useSettings } from "@/lib/settings";
import { DEFAULT_BACKGROUND_GRADIENT } from "./gradients";

// The device's wallpaper: one fixed layer behind the whole app (z-0 — App.tsx's Shell stacks
// above it at z-10). Same setting for every thread, same in Local and Live: it's pure device
// state (lib/settings.ts + lib/backgroundImage.ts), so neither mode needs to know it exists.
// "gradient" (the out-of-the-box default) and "image" (the user's own pick) are the only two
// types that render anything; "none" is the explicit opt-out.
export const BackgroundLayer = () => {
  const { background } = useSettings();
  const url = useBackgroundImageUrl(background.type === "image");

  if (background.type === "none") return null;
  if (background.type === "image" && !url) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
      style={{
        backgroundImage: background.type === "image" ? `url(${url})` : DEFAULT_BACKGROUND_GRADIENT,
        opacity: background.opacity / 100,
      }}
    />
  );
};

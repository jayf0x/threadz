import type { Theme } from "@/components/ui/theme-toggle";
import type { PaletteId } from "@/themes/palettes";

declare global {
  interface Window {
    /** Defined inline in index.html so the theme paints before first paint.
     * Single writer for the root class + localStorage — React only calls it (ui/theme-toggle.tsx). */
    _setTheme: (theme: Theme | null) => void;
    /** Same pattern, for the color palette (`data-palette` on <html>) — React only calls it
     * (features/settings/sections/AppearanceSection.tsx). */
    _setPalette: (palette: PaletteId) => void;
  }
}

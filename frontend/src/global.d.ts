import type { Theme } from "@/components/ui/theme-toggle";

declare global {
  interface Window {
    /** Defined inline in index.html so the theme paints before first paint.
     * Single writer for the root class + localStorage — React only calls it (ui/theme-toggle.tsx). */
    _setTheme: (theme: Theme | null) => void;
  }
}

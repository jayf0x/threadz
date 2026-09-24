// The palette picker's data (Settings' Appearance section). Not a general theming API — just
// enough to preview and pick one of the CSS files in this folder. `swatch` holds literal preview
// colors (this directory is lint:tokens' one exemption: "Themes are the one place raw color
// literals belong") because a preset's swatch has to show ITS colors regardless of which palette
// is actually active — there's no CSS var for "what oklch background does dracula use".
//
// Names are recognizable dev-culture theme names (editor/terminal colorschemes), not poetic ones —
// see AGENTS.md's naming note. A light-identity entry (base block is light) pairs with a same-family
// dark entry where one exists (gruvbox-light/gruvbox-dark, one-light/one-dark); everforest and
// solarized-light don't have a picker-visible dark sibling, but forcing dark on either still shows
// that family's real dark variant (see their .css files). Everything else here is an always-dark
// identity (no real light variant) — forcing "light" on one of those still shows that theme.

export type PaletteId =
  | "gruvbox-light"
  | "gruvbox-dark"
  | "one-light"
  | "one-dark"
  | "everforest"
  | "solarized-light"
  | "night-owl"
  | "dracula"
  | "nord"
  | "ubuntu"
  | "monokai"
  | "catppuccin";

export type Palette = {
  id: PaletteId;
  label: string;
  swatch: { background: string; primary: string };
};

export const PALETTES: Palette[] = [
  {
    id: "gruvbox-light",
    label: "Gruvbox Light",
    swatch: { background: "oklch(0.973 0.008 85)", primary: "oklch(0.66 0.14 68)" },
  },
  {
    id: "one-light",
    label: "One Light",
    swatch: { background: "oklch(0.975 0.006 250)", primary: "oklch(0.55 0.09 255)" },
  },
  {
    id: "everforest",
    label: "Everforest",
    swatch: { background: "oklch(0.972 0.012 140)", primary: "oklch(0.55 0.1 145)" },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    swatch: { background: "oklch(0.974 0.026 90)", primary: "oklch(0.644 0.102 187)" },
  },
  {
    id: "night-owl",
    label: "Night Owl",
    swatch: { background: "oklch(0.193 0.045 244)", primary: "oklch(0.829 0.092 181)" },
  },
  {
    id: "dracula",
    label: "Dracula",
    swatch: { background: "oklch(0.288 0.022 278)", primary: "oklch(0.742 0.149 302)" },
  },
  {
    id: "nord",
    label: "Nord",
    swatch: { background: "oklch(0.324 0.023 264)", primary: "oklch(0.775 0.062 218)" },
  },
  {
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    swatch: { background: "oklch(0.277 0 90)", primary: "oklch(0.731 0.182 52)" },
  },
  {
    id: "ubuntu",
    label: "Ubuntu",
    swatch: { background: "oklch(0.223 0.071 343)", primary: "oklch(0.641 0.194 38)" },
  },
  {
    id: "monokai",
    label: "Monokai",
    swatch: { background: "oklch(0.274 0.011 115)", primary: "oklch(0.642 0.24 8)" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    swatch: { background: "oklch(0.243 0.03 284)", primary: "oklch(0.787 0.119 305)" },
  },
  {
    id: "one-dark",
    label: "One Dark",
    swatch: { background: "oklch(0.293 0.016 264)", primary: "oklch(0.73 0.121 245)" },
  },
];

export const DEFAULT_PALETTE: PaletteId = "gruvbox-light";

export const isPaletteId = (v: string): v is PaletteId => PALETTES.some((p) => p.id === v);

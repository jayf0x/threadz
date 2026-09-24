// The palette picker's data (Settings' Appearance section). A palette is a colour *family* that ships
// both a light and a dark mode (the matching `themes/<id>.css`: base block = light, `.dark`/`.system`
// = dark); which mode is showing is the Light/System/Dark toggle's job alone — a palette never
// decides it. That's why there is no "Gruvbox Light" / "Gruvbox Dark" pair here and no always-dark
// identities (Dracula, Monokai…): forcing "light" on those would still have shown dark, which is
// exactly the confusion this replaced.
//
// `swatch` holds literal preview colours per mode (this directory is lint:tokens' one exemption:
// "Themes are the one place raw color literals belong") because a preset's swatch has to show ITS
// colours regardless of which palette is actually active. Names are recognizable dev-culture theme
// names; they aren't shown in the UI (a dot per family, `label` is the accessible name).

export type PaletteId = "gruvbox" | "one" | "everforest" | "solarized" | "catppuccin" | "nord";

type Swatch = { background: string; primary: string };

export type Palette = {
  id: PaletteId;
  label: string;
  swatch: { light: Swatch; dark: Swatch };
};

export const PALETTES: Palette[] = [
  {
    id: "gruvbox",
    label: "Gruvbox",
    swatch: {
      light: { background: "oklch(0.973 0.008 85)", primary: "oklch(0.66 0.14 68)" },
      dark: { background: "oklch(0.165 0.008 70)", primary: "oklch(0.74 0.13 72)" },
    },
  },
  {
    id: "one",
    label: "One",
    swatch: {
      light: { background: "oklch(0.975 0.006 250)", primary: "oklch(0.55 0.09 255)" },
      dark: { background: "oklch(0.16 0.015 255)", primary: "oklch(0.68 0.09 255)" },
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    swatch: {
      light: { background: "oklch(0.972 0.012 140)", primary: "oklch(0.55 0.1 145)" },
      dark: { background: "oklch(0.155 0.014 145)", primary: "oklch(0.68 0.1 148)" },
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    swatch: {
      light: { background: "oklch(0.974 0.026 90)", primary: "oklch(0.644 0.102 187)" },
      dark: { background: "oklch(0.267 0.049 220)", primary: "oklch(0.644 0.102 187)" },
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    swatch: {
      light: { background: "oklch(0.958 0.006 265)", primary: "oklch(0.555 0.25 297)" },
      dark: { background: "oklch(0.243 0.03 284)", primary: "oklch(0.787 0.119 305)" },
    },
  },
  {
    id: "nord",
    label: "Nord",
    swatch: {
      light: { background: "oklch(0.951 0.007 261)", primary: "oklch(0.594 0.077 254)" },
      dark: { background: "oklch(0.324 0.023 264)", primary: "oklch(0.775 0.062 218)" },
    },
  },
];

export const DEFAULT_PALETTE: PaletteId = "gruvbox";

export const isPaletteId = (v: string): v is PaletteId => PALETTES.some((p) => p.id === v);

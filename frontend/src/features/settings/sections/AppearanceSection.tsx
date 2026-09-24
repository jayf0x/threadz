import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";
import { DEFAULT_PALETTE, isPaletteId, PALETTES, type PaletteId } from "@/themes/palettes";
import { Section } from "./SettingsSection";

const readPalette = (): PaletteId => {
  const current = document.documentElement.dataset.palette ?? DEFAULT_PALETTE;
  return isPaletteId(current) ? current : DEFAULT_PALETTE;
};

const read = () => {
  const c = document.documentElement.classList;
  return c.contains("dark") || (c.contains("system") && matchMedia("(prefers-color-scheme: dark)").matches);
};

// Whether the page is showing its dark mode right now, however it got there (forced by the toggle, or
// "system" resolving through the OS setting) — so each swatch previews the mode you'd actually see.
const useIsDark = () => {
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(read());
    const observer = new MutationObserver(update); // the toggle flips a class on <html>
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return dark;
};

// The Light/System/Dark toggle decides light vs dark; the palettes below are colour families that
// each have both, so picking one never fights the toggle. `window._setPalette` is index.html's
// pre-paint script, same single-writer pattern as `window._setTheme`.
export const AppearanceSection = () => {
  const [palette, setPalette] = useState<PaletteId>(readPalette);
  const dark = useIsDark();

  return (
    <Section title="Appearance">
      <ThemeToggle className="mb-4" />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Palette</legend>
        {PALETTES.map((p) => {
          const active = palette === p.id;
          const { background, primary } = dark ? p.swatch.dark : p.swatch.light;
          return (
            <label key={p.id} title={p.label} className="cursor-pointer">
              <input
                type="radio"
                name="palette"
                value={p.id}
                checked={active}
                onChange={() => {
                  window._setPalette(p.id);
                  setPalette(p.id);
                }}
                className="peer sr-only"
              />
              <span className="sr-only">{p.label}</span>
              {/* Always bordered — muted when idle, primary when picked — so a light swatch on a light
                  page (or dark on dark) never loses its edge. */}
              <span
                aria-hidden
                className={cn(
                  "block size-11 rounded-full border-2 transition-transform peer-focus-visible:outline peer-focus-visible:outline-ring",
                  active ? "scale-110 border-primary" : "border-muted-foreground/40 hover:scale-105",
                )}
                style={{ background: `linear-gradient(135deg, ${background} 50%, ${primary} 50%)` }}
              />
            </label>
          );
        })}
      </fieldset>
    </Section>
  );
};

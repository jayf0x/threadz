import { useState } from "react";
import { cn } from "@/lib/cn";
import { DEFAULT_PALETTE, isPaletteId, PALETTES, type PaletteId } from "@/themes/palettes";
import { Section } from "./SettingsSection";

const readPalette = (): PaletteId => {
  const current = document.documentElement.dataset.palette ?? DEFAULT_PALETTE;
  return isPaletteId(current) ? current : DEFAULT_PALETTE;
};

// Light/dark/system lives in the sidebar footer (ThemeToggle) — this is the other half of
// appearance, the color palette itself. `window._setPalette` is index.html's pre-paint script,
// same single-writer pattern as `window._setTheme`.
export const AppearanceSection = () => {
  const [palette, setPalette] = useState<PaletteId>(readPalette);

  return (
    <Section title="Appearance">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">Palette</legend>
        {PALETTES.map((p) => {
          const active = palette === p.id;
          return (
            <label key={p.id} title={p.label} className="flex cursor-pointer flex-col items-center gap-1.5">
              <input
                type="radio"
                name="palette"
                value={p.id}
                checked={active}
                onChange={() => {
                  window._setPalette(p.id);
                  setPalette(p.id);
                }}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "size-8 rounded-full border-2 transition-transform has-focus-visible:outline",
                  active ? "scale-110 border-primary" : "border-border hover:scale-105",
                )}
                style={{ background: `linear-gradient(135deg, ${p.swatch.background} 50%, ${p.swatch.primary} 50%)` }}
              />
              <span className="text-[11px] text-muted-foreground">{p.label}</span>
            </label>
          );
        })}
      </fieldset>
    </Section>
  );
};

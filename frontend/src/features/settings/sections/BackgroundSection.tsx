import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearBackgroundImage, setBackgroundImage, useBackgroundImageUrl } from "@/lib/backgroundImage";
import { cn } from "@/lib/cn";
import { type BackgroundType, setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

const TYPES: { value: BackgroundType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "image", label: "Image" },
];

// Same wallpaper for every thread (lib/settings.ts's `background` + lib/backgroundImage.ts's
// IndexedDB blob) — device-local, so it's already identical in Local and Live without either mode
// knowing it exists. A fresh install starts on the "gradient" default (a subtle ambient wash, see
// features/appearance/gradients.ts) — that's not one of the choices here, only the explicit
// opt-out (None) and the user's own wallpaper (Image) are, since picking either replaces it for
// good.
export const BackgroundSection = () => {
  const { background } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useBackgroundImageUrl(background.type === "image");

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      await setBackgroundImage(file);
      setSetting("background", { ...background, type: "image" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that file.");
    }
  };

  const remove = async () => {
    await clearBackgroundImage();
    setSetting("background", { ...background, type: "none" });
  };

  return (
    <Section title="Background">
      <fieldset className="flex gap-px border border-border p-px">
        <legend className="sr-only">Background type</legend>
        {TYPES.map(({ value, label }) => (
          <label
            key={value}
            className={cn(
              "flex-1 cursor-pointer px-3 py-1.5 text-center text-xs font-medium transition-colors has-focus-visible:outline has-focus-visible:outline-ring",
              background.type === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="background-type"
              value={value}
              checked={background.type === value}
              onChange={() => setSetting("background", { ...background, type: value })}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {background.type === "image" && (
        <div className="mt-3">
          {previewUrl && (
            <div
              className="mb-2 h-24 w-full rounded-md border border-border bg-cover bg-center"
              style={{ backgroundImage: `url(${previewUrl})` }}
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              {previewUrl ? "Replace…" : "Choose image or GIF…"}
            </Button>
            {previewUrl && (
              <Button size="sm" variant="ghost" onClick={remove}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      )}

      {background.type !== "none" && (
        <label className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Opacity</span>
          <input
            type="range"
            min={5}
            max={100}
            value={background.opacity}
            onChange={(e) => setSetting("background", { ...background, opacity: Number(e.target.value) })}
            className="flex-1 accent-primary"
          />
          <span className="w-9 text-right font-mono text-xs text-muted-foreground">{background.opacity}%</span>
        </label>
      )}
    </Section>
  );
};

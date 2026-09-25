import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearBackgroundImage, setBackgroundImage, useBackgroundImageUrl } from "@/lib/backgroundImage";
import { DEFAULT_BACKGROUND_OPACITY, setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

// Same wallpaper for every thread (lib/settings.ts's `background` + lib/backgroundImage.ts's
// IndexedDB blob) — device-local, so it's already identical in Local and Live without either mode
// knowing it exists. One image, one way out: Remove goes back to the default faint wash. The slider is
// how much of the image shows through the panes on top of it.
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
      // A first image starts at the default; replacing one keeps the level you had.
      const opacity = background.type === "image" ? background.opacity : DEFAULT_BACKGROUND_OPACITY;
      setSetting("background", { type: "image", opacity });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that file.");
    }
  };

  const remove = async () => {
    await clearBackgroundImage();
    setSetting("background", { ...background, type: "gradient" });
  };

  return (
    <Section title="Background">
      {previewUrl && (
        <div
          className="mb-3 h-28 w-full rounded-2xl border border-border bg-cover bg-center"
          style={{ backgroundImage: `url(${previewUrl})` }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <ImagePlus className="size-5 md:size-4" />
          {previewUrl ? "Replace" : "Choose image"}
        </Button>
        {previewUrl && (
          <Button variant="ghost" onClick={remove}>
            <Trash2 className="size-5 md:size-4" />
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

      {previewUrl && (
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <span className="text-muted-foreground">Opacity</span>
          <input
            type="range"
            min={5}
            max={100}
            value={background.opacity}
            onChange={(e) => setSetting("background", { ...background, opacity: Number(e.target.value) })}
            className="h-11 flex-1 accent-primary"
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{background.opacity}%</span>
        </label>
      )}
    </Section>
  );
};

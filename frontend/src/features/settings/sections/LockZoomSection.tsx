import { setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

export const LockZoomSection = () => {
  const { lockZoom } = useSettings();
  return (
    <Section title="Display">
      <label className="flex cursor-pointer items-start gap-4">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Lock zoom</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
            No pinch or double-tap zoom; stops the page getting stuck zoomed on a phone.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={lockZoom}
          aria-checked={lockZoom}
          onChange={(e) => setSetting("lockZoom", e.target.checked)}
        />
        <span
          aria-hidden
          className="mt-0.5 h-5 w-9 shrink-0 rounded-full border border-border bg-background p-0.5 transition-colors duration-200 after:block after:size-3.5 after:rounded-full after:bg-muted-foreground after:transition-all after:duration-200 peer-checked:border-primary peer-checked:bg-primary peer-checked:after:translate-x-4 peer-checked:after:bg-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
        />
      </label>
    </Section>
  );
};

import { Switch } from "@/components/ui/switch";
import { setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

export const LockZoomSection = () => {
  const { lockZoom, gutterMarks } = useSettings();
  return (
    <Section title="Display">
      <div className="space-y-3">
        <Switch label="Lock zoom" checked={lockZoom} onChange={(v) => setSetting("lockZoom", v)} />
        <Switch
          label="Gutter marks"
          hint="Other threads, links and values as marks under each message."
          checked={gutterMarks}
          onChange={(v) => setSetting("gutterMarks", v)}
        />
      </div>
    </Section>
  );
};

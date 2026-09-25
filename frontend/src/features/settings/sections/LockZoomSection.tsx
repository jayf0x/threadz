import { Switch } from "@/components/ui/switch";
import { setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

export const LockZoomSection = () => {
  const { lockZoom } = useSettings();
  return (
    <Section title="Display">
      <Switch label="Lock zoom" checked={lockZoom} onChange={(v) => setSetting("lockZoom", v)} />
    </Section>
  );
};

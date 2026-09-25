import { Switch } from "@/components/ui/switch";
import { setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

export const NamingSection = () => {
  const { autoName } = useSettings();
  return (
    <Section title="Naming">
      <Switch
        label="Name a thread from its first note"
        hint="A title you typed yourself is never replaced."
        checked={autoName}
        onChange={(v) => setSetting("autoName", v)}
      />
    </Section>
  );
};

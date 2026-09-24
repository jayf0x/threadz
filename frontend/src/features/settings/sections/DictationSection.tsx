import { Section } from "./SettingsSection";
import { VoiceSettings } from "./VoiceSettings";

export const DictationSection = () => (
  <Section title="Dictation · speech model runs on this device">
    <VoiceSettings />
  </Section>
);

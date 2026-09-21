import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { setSetting, useSettings } from "@/lib/settings";
import { VoiceSettings } from "./VoiceSettings";

// The sidebar's second view. Everything here is per device: nothing syncs to main.
export const SettingsPanel = () => {
  const { autoName } = useSettings();

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Settings</h1>
        <Eyebrow className="mt-2">This device only</Eyebrow>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        <Section title="Naming">
          <label className="flex cursor-pointer items-start gap-4">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Name a thread from its first note</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                Once that note is sent or edited. A title you typed yourself is never replaced.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={autoName}
              aria-checked={autoName}
              onChange={(e) => setSetting("autoName", e.target.checked)}
            />
            <span
              aria-hidden
              className="mt-0.5 h-5 w-9 shrink-0 rounded-full border border-border bg-background p-0.5 transition-colors duration-200 after:block after:size-3.5 after:rounded-full after:bg-muted-foreground after:transition-all after:duration-200 peer-checked:border-primary peer-checked:bg-primary peer-checked:after:translate-x-4 peer-checked:after:bg-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            />
          </label>
        </Section>

        <Section title="Dictation · speech model runs on this device">
          <VoiceSettings />
        </Section>
      </div>
    </>
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-rule px-5 py-4">
    <Eyebrow className="mb-3">{title}</Eyebrow>
    {children}
  </section>
);

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field } from "@/components/ui/field";
import { DEFAULT_BACKEND_URL, HAS_BACKEND } from "@/lib/config";
import { setSetting, useSettings } from "@/lib/settings";
import { VoiceSettings } from "./VoiceSettings";

// The sidebar's second view. Everything here is per device: nothing syncs to main.
export const SettingsPanel = () => {
  const { autoName, backendUrl } = useSettings();

  return (
    <>
      <header className="px-5 pb-4 pt-6">
        <h1 className="font-serif text-4xl leading-none tracking-tight">Settings</h1>
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

        {HAS_BACKEND && (
          <Section title="Backend">
            <BackendUrlField value={backendUrl} />
          </Section>
        )}

        <Section title="Dictation · speech model runs on this device">
          <VoiceSettings />
        </Section>
      </div>
    </>
  );
};

// A phone that installed the PWA from `localhost` (instead of the Mac's LAN IP or Tailscale
// address) is permanently pointed at itself — reinstalling doesn't fix it. This is the escape
// hatch: a device-only override, applied on the next request, no reload required.
const BackendUrlField = ({ value }: { value: string | null }) => {
  const [draft, setDraft] = useState(value ?? "");

  // Another tab (or our own commit below) changed the stored value — reflect it, unless it's
  // simply echoing what this field just committed.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim().replace(/\/$/, "");
    setDraft(trimmed);
    setSetting("backendUrl", trimmed || null);
  };

  return (
    <Field
      label="Backend URL"
      hint="Override if the app can't reach it automatically."
      placeholder={DEFAULT_BACKEND_URL}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-rule px-5 py-4">
    <Eyebrow className="mb-3">{title}</Eyebrow>
    {children}
  </section>
);

import { useEffect, useState } from "react";
import { Field } from "@/components/ui/field";
import { DEFAULT_BACKEND_URL, HAS_BACKEND } from "@/lib/config";
import { setSetting, useSettings } from "@/lib/settings";
import { Section } from "./SettingsSection";

export const BackendSection = () => {
  const { backendUrl } = useSettings();
  if (!HAS_BACKEND) return null;
  return (
    <Section title="Backend">
      <BackendUrlField value={backendUrl} />
    </Section>
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
      hideLabel
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

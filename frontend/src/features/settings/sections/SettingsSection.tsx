import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

/** One Settings section: an eyebrow title over its controls in an inset card. Shared by every file under
 * sections/ — SettingsPanel.tsx (the shell) only ever assembles them, never their insides. */
export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-4 pt-5">
    <Eyebrow className="mb-2 px-1">{title}</Eyebrow>
    <div className="surface-sheen rounded-2xl border border-border p-4">{children}</div>
  </section>
);

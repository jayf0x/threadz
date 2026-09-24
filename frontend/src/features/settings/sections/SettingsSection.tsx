import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

/** One Settings section: an eyebrow title over its own controls. Shared by every file under
 * sections/ — SettingsPanel.tsx (the shell) only ever assembles them, never their insides. */
export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-rule px-5 py-4">
    <Eyebrow className="mb-3">{title}</Eyebrow>
    {children}
  </section>
);

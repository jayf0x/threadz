import { AppearanceSection } from "./sections/AppearanceSection";
import { BackendSection } from "./sections/BackendSection";
import { BackgroundSection } from "./sections/BackgroundSection";
import { DictationSection } from "./sections/DictationSection";
import { NamingSection } from "./sections/NamingSection";

// The sidebar's second view. Everything here is per device: nothing syncs to main. One file per
// section under sections/ — adding another never touches this shell.
export const SettingsPanel = () => (
  <>
    <header className="px-5 pb-4 pt-6">
      <h1 className="font-serif text-4xl leading-none tracking-tight">Settings</h1>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
      <NamingSection />
      <BackendSection />
      <AppearanceSection />
      <BackgroundSection />
      <DictationSection />
    </div>
  </>
);

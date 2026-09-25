import { AppearanceSection } from "./sections/AppearanceSection";
import { BackendSection } from "./sections/BackendSection";
import { BackgroundSection } from "./sections/BackgroundSection";
import { DataSection } from "./sections/DataSection";
import { DictationSection } from "./sections/DictationSection";
import { LockZoomSection } from "./sections/LockZoomSection";
import { NamingSection } from "./sections/NamingSection";
import { SyncSection } from "./sections/SyncSection";

// The sidebar's Settings view. Everything here is per device: nothing syncs to main. One file per
// section under sections/ — adding another never touches this shell. Order: sync status first
// (was the sidebar footer), then day-to-day settings, then import/export last (low usage).
export const SettingsPanel = () => (
  <>
    <header className="px-5 pb-3 pt-6">
      <h1 className="font-serif text-[32px] leading-none tracking-tight">Settings</h1>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-8">
      <SyncSection />
      <NamingSection />
      <LockZoomSection />
      <BackendSection />
      <AppearanceSection />
      <BackgroundSection />
      <DictationSection />
      <DataSection />
    </div>
  </>
);

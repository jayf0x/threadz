import { registerSW } from "virtual:pwa-register";
import { toast } from "@/components/ui/toast";
import { isBusy } from "./idle";

const CHECK_MS = 30 * 60 * 1000;

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;

/** Registers the service worker and prompts whenever a new build is waiting. iOS rarely checks by
 * itself, so also check on foregrounding and every 30 min while visible. */
export const registerUpdates = () => {
  updateSW = registerSW({
    onNeedRefresh: () =>
      toast({
        title: "Update available",
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Update", onClick: () => void applyUpdate() },
      }),
    onRegisteredSW: (_url, reg) => {
      registration = reg;
    },
  });
  const check = () => {
    if (document.visibilityState === "visible") registration?.update().catch(() => {});
  };
  document.addEventListener("visibilitychange", check);
  setInterval(check, CHECK_MS);
};

/** Applies a waiting build, or (version mismatch, none waiting) drops the service worker and caches
 * and reloads. Refuses while an editor holds unsent text; the user taps again after. */
export const applyUpdate = async () => {
  if (isBusy()) {
    toast({ title: "Send or save your text first", description: "Then tap Update again." });
    return;
  }
  await registration?.update().catch(() => {});
  if (registration?.waiting && updateSW) return updateSW(true);
  for (const reg of (await navigator.serviceWorker?.getRegistrations()) ?? []) await reg.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
  location.reload();
};

// Device storage: persistence request (one call site for the whole app) and usage/quota for Settings → Data.

export type StorageStatus = { usage: number | null; quota: number | null; persisted: boolean | null };

export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Asks the browser not to evict our storage. Installed PWA only (a browser tab is refused or prompts
 * pointlessly); never throws, unsupported is fine. */
export const requestPersistence = async (): Promise<void> => {
  try {
    if (isStandalone()) await navigator.storage?.persist?.();
  } catch {
    // refused or unsupported
  }
};

export const storageStatus = async (): Promise<StorageStatus> => {
  const [est, persisted] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => undefined),
    navigator.storage?.persisted?.().catch(() => undefined),
  ]);
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted: persisted ?? null };
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

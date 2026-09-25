import { useSyncExternalStore } from "react";

/** Live `matchMedia(query).matches`. False where there is no matchMedia (tests, SSR). */
export const useMedia = (query: string): boolean =>
  useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", notify);
      return () => list?.removeEventListener("change", notify);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );

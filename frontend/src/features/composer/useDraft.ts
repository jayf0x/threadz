import { useRef, useState } from "react";

// An unsent composer draft survives reloads, crashes and remounts (e.g. a mode
// switch). Cleared only by the caller, once the text is safely stored elsewhere.
// Storage is written directly (not inside a state updater) so clearing still works
// if the composer was unmounted meanwhile — e.g. main dropped and the app switched mode.
export const useDraft = (threadId: string) => {
  const key = `threadz.draft.${threadId}`;
  const [draft, setDraftState] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const latest = useRef(draft);

  const setDraft = (next: string | ((d: string) => string)) => {
    const v = typeof next === "function" ? next(latest.current) : next;
    latest.current = v;
    try {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch {}
    setDraftState(v);
  };

  return [draft, setDraft] as const;
};

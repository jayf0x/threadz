import { useRef, useState } from "react";

// An unsent composer draft survives reloads, crashes and remounts (e.g. a mode
// switch). Cleared only by the caller, once the text is safely stored elsewhere.
// Storage is written directly (not inside a state updater) so clearing still works
// if the composer was unmounted meanwhile — e.g. main dropped and the app switched mode.
// The draft follows `threadId`: if the same instance is handed another thread it shows that thread's
// draft (it no longer relies on the parent remounting it with a key).
export const useDraft = (threadId: string) => {
  const key = `threadz.draft.${threadId}`;
  const [draft, setDraftState] = useState(() => ({ key, text: read(key) }));
  const latest = useRef(draft);

  if (draft.key !== key) {
    // React re-renders straight away with the new state; this pass's output is discarded.
    const next = { key, text: read(key) };
    latest.current = next;
    setDraftState(next);
  }

  const setDraft = (next: string | ((d: string) => string)) => {
    const text = typeof next === "function" ? next(latest.current.text) : next;
    latest.current = { key, text };
    try {
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {}
    setDraftState(latest.current);
  };

  return [draft.text, setDraft] as const;
};

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

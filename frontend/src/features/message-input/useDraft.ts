import { useRef, useState } from "react";

// An unsent draft survives reloads, crashes and remounts (e.g. a mode switch). Cleared only by the
// caller, once the text is safely stored elsewhere. Storage is written directly (not inside a state
// updater) so clearing still works if the input was unmounted meanwhile — e.g. main dropped and the
// app switched mode.
// `target` keys the draft to whatever it belongs to: a thread id for the composer, or e.g.
// `annotation:${messageId}` for an annotation — each target gets its own slot, and the same hook
// instance follows `target` if the caller hands it another one (it no longer relies on the parent
// remounting it with a key).
export const useDraft = (target: string) => {
  const key = draftStorageKey(target);
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

export const draftStorageKey = (target: string) => `threadz.draft.${target}`;

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

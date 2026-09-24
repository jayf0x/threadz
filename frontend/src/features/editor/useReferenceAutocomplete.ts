import { useEffect, useMemo, useState } from "react";
import { exportSnapshot } from "@/lib/local";
import { messageSnippet, type ReferenceAutocompleteState, searchMessages, searchThreads } from "@/lib/references";
import type { Message, Thread } from "@/lib/types";
import type { ReferenceOption } from "./ReferenceAutocompleteMenu";

/** The reference autocomplete's data side: local-only (decision 4) search results for whatever
 * `state` (from `lib/references.ts`'s `nextAutocompleteState`) currently asks for, plus which
 * option is highlighted. Framework-agnostic beyond React itself — both adapters (RawEditor's
 * textarea wiring, CrepeEditor's ProseMirror wiring) share this; only how they get `state` in the
 * first place, and how they turn a pick into a text/doc edit, differs between them. */
export const useReferenceAutocomplete = (state: ReferenceAutocompleteState) => {
  const open = state.stage !== "closed";
  const [snapshot, setSnapshot] = useState<{ threads: Thread[]; messages: Message[] } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  // Reloaded each time the autocomplete (re)opens, not on every keystroke: an IndexedDB read is
  // cheap at this app's scale, but there's no reason to repeat it while a session is just narrowing
  // an already-open query — see `lib/local.ts`'s `exportSnapshot`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    exportSnapshot().then((snap) => {
      if (!cancelled) setSnapshot({ threads: snap.threads, messages: snap.messages });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options: ReferenceOption[] = useMemo(() => {
    if (!snapshot || !open) return [];
    if (state.stage === "thread")
      return searchThreads(snapshot.threads, state.query).map((t) => ({ id: t.id, label: t.title }));
    return searchMessages(snapshot.messages, state.threadId, state.query, undefined, state.from).map((m) => ({
      id: m.id,
      label: messageSnippet(m.content) || "(empty)",
    }));
  }, [snapshot, open, state]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the option set changes shape, not on every render
  useEffect(() => setHighlighted(0), [options]);

  const findThread = (id: string) => snapshot?.threads.find((t) => t.id === id);
  const findMessage = (id: string) => snapshot?.messages.find((m) => m.id === id);

  return { options, highlighted, setHighlighted, findThread, findMessage };
};

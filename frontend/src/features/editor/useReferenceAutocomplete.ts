import { useEffect, useMemo, useState } from "react";
import { allMessages, listAllNotes, listLinkCandidates, listPropertySets } from "@/lib/data";
import {
  type LinkRefCandidate,
  messageSnippet,
  type NoteRefCandidate,
  type PropertySetRefCandidate,
  type ReferenceAutocompleteState,
  searchLinks,
  searchMessages,
  searchNotes,
  searchPropertySets,
  searchThreads,
} from "@/lib/references";
import type { Message, Thread } from "@/lib/types";
import type { ReferenceOption } from "./ReferenceAutocompleteMenu";

// Per-kind cap at the "thread" stage, so four kinds fit in the same `RESULT_LIMIT`-sized dropdown
// `searchThreads` alone used to fill. Threads get the biggest share — the trigger's original and
// still most common use — the other three kinds get a smaller, still-useful slice each.
const CAP = { thread: 5, note: 3, link: 2, property_set: 2 };

type Snapshot = {
  threads: Thread[];
  messages: Message[];
  notes: NoteRefCandidate[];
  links: LinkRefCandidate[];
  propertySets: PropertySetRefCandidate[];
};

/** The reference autocomplete's data side: local-only (decision 4) search results for whatever
 * `state` (from `lib/references.ts`'s `nextAutocompleteState`) currently asks for, plus which
 * option is highlighted. `MarkdownEditor` gets `state` from `referencePlugin` and turns a pick into a
 * doc edit; the e2e test drives the same hook from a plain textarea. The "thread" stage searches all
 * four reference kinds at once (wave 6 phase 2, "references to anything") — the "message" stage
 * (narrowing a picked thread down to one of its messages) stays thread-only, same as before. */
export const useReferenceAutocomplete = (state: ReferenceAutocompleteState) => {
  const open = state.stage !== "closed";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  // Reloaded each time the autocomplete (re)opens, not on every keystroke: a phone-db read is cheap
  // at this app's scale, but there's no reason to repeat it while a session is just narrowing an
  // already-open query — see `lib/data.ts`'s `allMessages`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([allMessages(), listAllNotes(), listLinkCandidates(), listPropertySets()]).then(
      ([{ threads, messages }, allNotes, links, propertySets]) => {
        if (cancelled) return;
        setSnapshot({
          threads,
          messages,
          notes: allNotes.map((p) => ({ entityId: p.entityId, content: p.content, createdAt: p.createdAt })),
          links,
          propertySets: propertySets.map((s) => ({ id: s.id, name: s.name })),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options: ReferenceOption[] = useMemo(() => {
    if (!snapshot || !open) return [];
    if (state.stage === "thread") {
      const threads = searchThreads(snapshot.threads, state.query, CAP.thread).map((t) => ({
        id: t.id,
        label: t.title,
        kind: "thread" as const,
      }));
      const notes = searchNotes(snapshot.notes, state.query, CAP.note).map((n) => ({
        id: n.entityId,
        label: messageSnippet(n.content) || "(empty)",
        kind: "note" as const,
      }));
      const links = searchLinks(snapshot.links, state.query, CAP.link).map((l) => ({
        id: l.id,
        label: l.label,
        kind: "link" as const,
      }));
      const propertySets = searchPropertySets(snapshot.propertySets, state.query, CAP.property_set).map((s) => ({
        id: s.id,
        label: s.name,
        kind: "property_set" as const,
      }));
      return [...threads, ...notes, ...links, ...propertySets];
    }
    return searchMessages(snapshot.messages, state.threadId, state.query, undefined, state.from).map((m) => ({
      id: m.id,
      label: messageSnippet(m.content) || "(empty)",
      kind: "message" as const,
    }));
  }, [snapshot, open, state]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the option set changes shape, not on every render
  useEffect(() => setHighlighted(0), [options]);

  const findThread = (id: string) => snapshot?.threads.find((t) => t.id === id);
  const findMessage = (id: string) => snapshot?.messages.find((m) => m.id === id);
  const findNote = (id: string) => snapshot?.notes.find((n) => n.entityId === id);
  const findLink = (id: string) => snapshot?.links.find((l) => l.id === id);
  const findPropertySet = (id: string) => snapshot?.propertySets.find((s) => s.id === id);

  return { options, highlighted, setHighlighted, findThread, findMessage, findNote, findLink, findPropertySet };
};

import type { Message, Version } from "./types";

// The "content + edit history" shape shared by a message and an annotation (an annotation is
// the same fields minus `role`) — everything below is generic over it so both reuse one merge.
type Versioned = { content: string; createdAt: number; editedAt?: number | null; edits?: Version[] };

// Same merge as the backend's `mergeVersions`: newest version wins, the rest become history.
// Symmetric, so device and main converge whatever order they sync in.
export const mergeVersions = (a: Version[], b: Version[]) => {
  const byAt = new Map<number, Version>();
  for (const v of [...a, ...b]) byAt.set(v.at, v);
  const all = [...byAt.values()].sort((x, y) => x.at - y.at);
  return { current: all.at(-1) as Version, edits: all.slice(0, -1) };
};

export const versionsOf = (m: Versioned): Version[] => [
  ...(m.edits ?? []),
  { content: m.content, at: m.editedAt ?? m.createdAt },
];

// Fold main's copy of a message (or annotation) into ours (or our edit into it).
export const mergeMessage = <T extends Versioned>(mine: T, theirs: T): T => {
  const { current, edits } = mergeVersions(versionsOf(mine), versionsOf(theirs));
  const edited = edits.length > 0;
  return { ...theirs, content: current.content, editedAt: edited ? current.at : null, edits };
};

// Reading order. Two devices that appended while apart can share a `seq`; the timestamp settles the tie.
export const bySeq = (a: Message, b: Message) => a.seq - b.seq || a.createdAt - b.createdAt;

// Annotations render ordered by (createdAt, id), not seq (they have none).
export const byCreatedThenId = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

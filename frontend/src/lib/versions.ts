import type { Message, Version } from "./types";

// Same merge as the backend's `mergeVersions`: newest version wins, the rest become history.
// Symmetric, so device and main converge whatever order they sync in.
export const mergeVersions = (a: Version[], b: Version[]) => {
  const byAt = new Map<number, Version>();
  for (const v of [...a, ...b]) byAt.set(v.at, v);
  const all = [...byAt.values()].sort((x, y) => x.at - y.at);
  return { current: all.at(-1) as Version, edits: all.slice(0, -1) };
};

export const versionsOf = (m: Message): Version[] => [
  ...(m.edits ?? []),
  { content: m.content, at: m.editedAt ?? m.createdAt },
];

// Fold main's copy of a message into ours (or our edit into it). Returns the merged message.
export const mergeMessage = (mine: Message, theirs: Message): Message => {
  const { current, edits } = mergeVersions(versionsOf(mine), versionsOf(theirs));
  const edited = edits.length > 0;
  return { ...theirs, content: current.content, editedAt: edited ? current.at : null, edits };
};

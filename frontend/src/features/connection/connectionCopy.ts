import type { SyncReport } from "@/lib/handoff";
import type { Unsynced } from "@/lib/types";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const describeUnsynced = (u: Unsynced) =>
  [
    u.threads && plural(u.threads, "new thread"),
    u.messages && plural(u.messages, "note"),
    u.deletions && plural(u.deletions, "deletion"),
  ]
    .filter(Boolean)
    .join(" · ");

// One plain sentence per thing that happened, only for the things that did.
export const describeReport = (r: SyncReport) =>
  [
    r.pushed ? `Sent ${plural(r.pushed, "change")} to main.` : "Main already had everything.",
    r.threads && `Picked up ${plural(r.threads, "thread")} from main.`,
    r.removed &&
      `${plural(r.removed, "thread")} deleted on main ${r.removed === 1 ? "was" : "were"} removed here (copy kept in backups).`,
    r.keptLocal && `Kept ${plural(r.keptLocal, "thread")} deleted on main but edited here.`,
    r.keptRemote && `Kept ${plural(r.keptRemote, "thread")} deleted here but edited on main.`,
    r.skippedImages &&
      `Main refused ${plural(r.skippedImages, "photo")}; ${r.skippedImages === 1 ? "it stays" : "they stay"} on this device and the notes were sent without ${r.skippedImages === 1 ? "it" : "them"}.`,
    "You're live.",
  ]
    .filter(Boolean)
    .join(" ");

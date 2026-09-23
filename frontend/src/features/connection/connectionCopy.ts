import type { SyncReport } from "@/lib/handoff";
import type { Unsynced } from "@/lib/types";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const describeUnsynced = (u: Unsynced) =>
  [
    u.threads && plural(u.threads, "new thread"),
    u.messages && plural(u.messages, "note"),
    // "note" is already taken by messages above — an annotation is a note *on* a note.
    u.annotations && plural(u.annotations, "message note"),
    u.deletions && plural(u.deletions, "deletion"),
  ]
    .filter(Boolean)
    .join(" · ");

// One plain sentence per thing that happened, only for the things that did.
export const describeReport = (r: SyncReport) =>
  [
    r.pushed ? `Sent ${plural(r.pushed, "change")}.` : "Nothing to send.",
    r.threads && `Picked up ${plural(r.threads, "thread")}.`,
    r.removed &&
      `${plural(r.removed, "thread")} deleted remotely ${r.removed === 1 ? "was" : "were"} removed here (copy kept in backups).`,
    r.keptLocal && `Kept ${plural(r.keptLocal, "thread")} deleted remotely but edited here.`,
    r.keptRemote && `Kept ${plural(r.keptRemote, "thread")} deleted here but edited remotely.`,
    r.skippedImages &&
      `${plural(r.skippedImages, "photo")} couldn't send; ${r.skippedImages === 1 ? "it stays" : "they stay"} on this device, and the note went without ${r.skippedImages === 1 ? "it" : "them"}.`,
    "You're live.",
  ]
    .filter(Boolean)
    .join(" ");

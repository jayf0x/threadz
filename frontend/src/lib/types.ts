export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  renamedAt?: number | null; // last rename; newest wins on sync
  description: string | null;
  tags: string[];
  hasEmbedding: boolean;
};

// A previous text of a message; `at` (when that text was written) identifies it.
export type Version = { content: string; at: number };

// `meta`'s one typed field so far: the ⋯ menu's "Todo" toggle (see features/todos), a whole
// message flagged as a todo without inserting `/todo` text. Still a bag, not a closed shape — an
// index signature, so a future key can ride along without every reader needing to know about it.
// `editMessageMeta` (backend) / `toggleMessageTodo`/`removeMessageTodo` (lib/api.ts) always merge a
// patch into this, never replace it wholesale.
export type MessageMeta = { todo?: { done: boolean } } & Record<string, unknown>;

export type Message = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  seq: number;
  meta: MessageMeta | null;
  editedAt?: number | null; // null/absent = never edited
  edits?: Version[]; // previous texts, oldest first
  metaEditedAt?: number | null; // when meta was last patched; null/absent = never — own clock from editedAt
};

// A note attached to one message. Same fields as a message minus `role` (only the user writes
// annotations in v1), plus the thread and message it belongs to. No annotations of annotations:
// `messageId` always names a row in `messages`, never another annotation.
export type Annotation = {
  id: string;
  threadId: string;
  messageId: string;
  content: string;
  createdAt: number;
  editedAt?: number | null;
  edits?: Version[];
};

// LEGACY: the old offline queue. Nothing writes it any more; leftovers are drained
// into the local store on the first successful pull (see lib/replica.ts).
export type OutboxItem = {
  id: string; // client UUID == idempotency key sent to the backend
  threadId: string;
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

// Where reads/writes go. "local" = this device's own database is authoritative
// until the user explicitly syncs it back to the backend.
export type Mode = "live" | "local";

// Whole-store JSON: what the backend's /api/snapshot returns and what "Export backup" writes.
export type Snapshot = {
  version: 1;
  exportedAt: number;
  threads: Thread[];
  messages: Message[];
  // Optional so an old backup file (made before annotations existed) still imports cleanly.
  annotations?: Annotation[];
  // Threads deleted on this device. Backups keep them so a delete is recoverable by hand;
  // import ignores them.
  trash?: { thread: Thread; messages: Message[]; annotations?: Annotation[]; deletedAt: number }[];
};

// What a sync would push. Shown to the user before they confirm.
export type Unsynced = { threads: number; messages: number; annotations: number; deletions: number };

// Change detection: one hash per thread (title + message ids + edit times) and one for the whole store.
export type Head = { head: string; threads: Record<string, string> };

export type SyncPayload = {
  threads: { id: string; title: string; createdAt: number; renamedAt: number | null }[];
  messages: {
    id: string;
    threadId: string;
    role: "user" | "assistant";
    content: string;
    meta: unknown;
    createdAt: number;
    editedAt: number | null;
    edits: Version[];
    metaEditedAt: number | null;
  }[];
  annotations: {
    id: string;
    threadId: string;
    messageId: string;
    content: string;
    createdAt: number;
    editedAt: number | null;
    edits: Version[];
  }[];
  deletes: { id: string; baseHash: string }[];
  // Same idea as `deletes`, scoped to one annotation: `baseVersion` is the device's last-known
  // editedAt ?? createdAt for that row.
  annotationDeletes: { id: string; baseVersion: number }[];
};

export type SyncResult = Head & {
  created: number;
  appended: number;
  deleted: string[];
  kept: string[]; // deletes refused because main changed since our base
  missing: string[]; // notes skipped because main no longer has the thread
  hashes: Record<string, string>; // main's hash for every thread we touched
};

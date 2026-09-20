export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: string;
  description: string | null;
  tags: string[];
  hasEmbedding: boolean;
};

export type Message = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  seq: number;
  source: string;
  meta: Record<string, unknown> | null;
};

// v2 — backend endpoint only, not surfaced in the UI (see api.ts note).
export type Related = { id: string; title: string; score: number };

// An unsent draft sitting in this device's outbox — the ONLY mutable state.
// (Offline captures are always plain messages; asking Claude needs a connection.)
export type OutboxItem = {
  id: string; // client UUID == idempotency key sent to the backend
  threadId: string;
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

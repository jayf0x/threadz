import { BACKEND_URL } from "./config";
import type { Message, Thread } from "./types";

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(BACKEND_URL + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

export const api = {
  health: () => req<{ ok: boolean; model: string }>("/api/health"),

  listThreads: (q?: string, sort?: string) =>
    req<Thread[]>(`/api/threads?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort ? { sort } : {}) })}`),

  createThread: (body: { title: string; seed?: string; id?: string }) =>
    req<Thread>("/api/threads", { method: "POST", body: JSON.stringify(body) }),

  getThread: (id: string) => req<{ thread: Thread; messages: Message[] }>(`/api/threads/${id}`),

  deleteThread: (id: string) => req<{ ok: true }>(`/api/threads/${id}`, { method: "DELETE" }),

  // Idempotent append. Backend dedupes on `id`.
  appendMessage: (
    threadId: string,
    body: { id: string; role?: "user" | "assistant"; content: string; meta?: unknown },
  ) =>
    req<{ message: Message; inserted: boolean }>(`/api/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ask: (
    threadId: string,
    body: { prompt: string; commit: boolean; userMessageId?: string; assistantMessageId?: string },
  ) =>
    req<{ answer: string; committed: boolean }>(`/api/threads/${threadId}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // NOTE: GET /api/threads/:id/related exists on the backend but is a v2 feature —
  // deliberately not surfaced in the UI (embedding similarity wasn't giving
  // meaningful results at this scale). Wire a client method here when v2 revisits it.
};

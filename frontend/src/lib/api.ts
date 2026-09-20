import { BACKEND_URL } from "./config";
import { ApiError } from "./errors";
import { localApi } from "./local";
import { detach, getMode, replicaReady } from "./mode";
import type { Head, Message, SyncPayload, SyncResult, Thread } from "./types";

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(BACKEND_URL + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

export const remoteApi = {
  health: () => req<{ ok: boolean; model: string }>("/api/health"),

  listThreads: (q?: string, sort?: string) =>
    req<Thread[]>(`/api/threads?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort ? { sort } : {}) })}`),

  createThread: (body: { title: string; seed?: string; id?: string; createdAt?: number }) =>
    req<Thread>("/api/threads", { method: "POST", body: JSON.stringify(body) }),

  getThread: (id: string) => req<{ thread: Thread; messages: Message[]; hash?: string }>(`/api/threads/${id}`),

  renameThread: (id: string, title: string) =>
    req<Thread>(`/api/threads/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  // The previous text is kept by the backend (`edits`).
  editMessage: (threadId: string, id: string, content: string) =>
    req<{ message: Message }>(`/api/threads/${threadId}/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  deleteThread: (id: string) => req<{ ok: true }>(`/api/threads/${id}`, { method: "DELETE" }),

  // Idempotent append. Backend dedupes on `id`.
  appendMessage: (
    threadId: string,
    body: { id: string; role?: "user" | "assistant"; content: string; meta?: unknown; createdAt?: number },
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

export type Api = typeof remoteApi;

// Reachability probe. Short timeout: a Mac that's off must not hang the UI.
export const ping = () =>
  req<{ ok: boolean }>("/api/health", { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.ok,
    () => false,
  );

export const fetchHead = () => req<Head>("/api/head");

// A device's offline work, applied atomically on main after main backs itself up.
export const postSync = (payload: SyncPayload) =>
  req<SyncResult>("/api/sync", { method: "POST", body: JSON.stringify(payload) });

// Every screen talks to `api`. Live → main. If main can't be reached (a real network
// failure, confirmed by a probe; not an HTTP error) and the device already holds a full
// copy, drop into local mode once and answer from the device instead. Coming back to
// live is never automatic. Local → the device store, always.
const via = async <T>(live: () => Promise<T>, local: () => Promise<T>): Promise<T> => {
  if (getMode() === "local") return local();
  try {
    return await live();
  } catch (e) {
    if (e instanceof ApiError || !replicaReady() || (await ping())) throw e;
    detach();
    return local();
  }
};

export const api: Api = {
  health: () => via(remoteApi.health, localApi.health),
  listThreads: (q, sort) =>
    via(
      () => remoteApi.listThreads(q, sort),
      () => localApi.listThreads(q, sort),
    ),
  // A client id up front: if the reply is lost and we retry locally, main dedupes on it at sync.
  createThread: (body) => {
    const b = { ...body, id: body.id ?? crypto.randomUUID() };
    return via(
      () => remoteApi.createThread(b),
      () => localApi.createThread(b),
    );
  },
  getThread: (id) =>
    via(
      () => remoteApi.getThread(id),
      () => localApi.getThread(id),
    ),
  renameThread: (id, title) =>
    via(
      () => remoteApi.renameThread(id, title),
      () => localApi.renameThread(id, title),
    ),
  editMessage: (threadId, id, content) =>
    via(
      () => remoteApi.editMessage(threadId, id, content),
      () => localApi.editMessage(threadId, id, content),
    ),
  deleteThread: (id) =>
    via(
      () => remoteApi.deleteThread(id),
      () => localApi.deleteThread(id),
    ),
  appendMessage: (threadId, body) =>
    via(
      () => remoteApi.appendMessage(threadId, body),
      () => localApi.appendMessage(threadId, body),
    ),
  ask: (threadId, body) =>
    via(
      () => remoteApi.ask(threadId, body),
      () => localApi.ask(threadId, body),
    ),
};

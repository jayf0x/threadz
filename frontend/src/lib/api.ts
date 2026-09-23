import { getBackendUrl } from "./config";
import { ApiError } from "./errors";
import { localApi, seedId } from "./local";
import { detach, getMode, replicaReady } from "./mode";
import type { Annotation, Head, Message, SyncPayload, SyncResult, Thread } from "./types";

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(getBackendUrl() + path, {
    ...init,
    // Only requests with a body declare one: on a GET it would turn every read into a CORS preflight.
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null); // may be non-JSON, or JSON `null`
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    throw new ApiError(res.status, typeof error === "string" && error ? error : `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

export const remoteApi = {
  health: () => req<{ ok: boolean; model: string }>("/api/health"),

  listThreads: (q?: string, sort?: string) =>
    req<Thread[]>(`/api/threads?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort ? { sort } : {}) })}`),

  createThread: (body: { title: string; seed?: string; id?: string; createdAt?: number }) =>
    req<Thread>("/api/threads", { method: "POST", body: JSON.stringify(body) }),

  getThread: (id: string) =>
    req<{ thread: Thread; messages: Message[]; annotations: Annotation[]; hash?: string }>(`/api/threads/${id}`),

  renameThread: (id: string, title: string) =>
    req<Thread>(`/api/threads/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  // The previous text is kept by the backend (`edits`).
  editMessage: (threadId: string, id: string, content: string) =>
    req<{ message: Message }>(`/api/threads/${threadId}/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  // Non-textual message state (the ⋯ menu's "Add/Remove Todos", the sidebar's message-todo
  // checkbox) — merged into `meta`, never a content edit, so this hits its own small route instead
  // of editMessage above (see backend/server.ts). `removeMessageTodo` clears the flag entirely
  // (`meta.todo: null`, which editMessageMeta on the backend deletes rather than sets).
  toggleMessageTodo: (threadId: string, id: string, done: boolean) =>
    req<{ message: Message }>(`/api/threads/${threadId}/messages/${id}/meta`, {
      method: "PATCH",
      body: JSON.stringify({ meta: { todo: { done } } }),
    }),

  removeMessageTodo: (threadId: string, id: string) =>
    req<{ message: Message }>(`/api/threads/${threadId}/messages/${id}/meta`, {
      method: "PATCH",
      body: JSON.stringify({ meta: { todo: null } }),
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

  // B is a copy of A from its first message up to `uptoMessageId`. `newThreadId` is the client-minted
  // id (see `api.copyThread` below); idempotent on it, like `createThread`.
  copyThread: (
    threadId: string,
    body: { newThreadId: string; uptoMessageId: string; appendNote?: { id: string; content: string } },
  ) =>
    req<{ thread: Thread; messages: Message[]; annotations: Annotation[] }>(`/api/threads/${threadId}/copy`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // A note on one message. Idempotent append, like `appendMessage`.
  appendAnnotation: (threadId: string, messageId: string, body: { id: string; content: string; createdAt?: number }) =>
    req<{ annotation: Annotation; inserted: boolean }>(`/api/threads/${threadId}/messages/${messageId}/annotations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // The previous text is kept by the backend (`edits`), same as `editMessage`.
  editAnnotation: (threadId: string, id: string, content: string) =>
    req<{ annotation: Annotation }>(`/api/threads/${threadId}/annotations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  // Unconditional on the live path (conflict resolution is a sync concept, see SyncPayload.annotationDeletes).
  deleteAnnotation: (threadId: string, id: string) =>
    req<{ ok: true }>(`/api/threads/${threadId}/annotations/${id}`, { method: "DELETE" }),

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

// Images are raw bytes, one immutable file per hash (see lib/imageSync.ts).
export const putImageRemote = async (hash: string, blob: Blob) => {
  const res = await fetch(`${getBackendUrl()}/api/images/${hash}`, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new ApiError(res.status, `image upload failed: ${res.status}`);
};

export const fetchImageRemote = async (hash: string) => {
  const res = await fetch(`${getBackendUrl()}/api/images/${hash}`);
  if (!res.ok) throw new ApiError(res.status, `image ${res.status}`);
  return res.blob();
};

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
  // The seed is its own append with an id derived from the thread's (`seedId`), never the server's random one:
  // if the create lands on main but its reply is lost, the local retry writes the same note id and sync dedupes.
  createThread: ({ seed, ...body }) => {
    const b = { ...body, id: body.id ?? crypto.randomUUID() };
    const text = seed?.trim();
    return via(
      async () => {
        const thread = await remoteApi.createThread(b);
        if (text) await remoteApi.appendMessage(b.id, { id: seedId(b.id), content: text });
        return thread;
      },
      () => localApi.createThread({ ...b, seed: text }),
    );
  },
  getThread: (id) =>
    via(
      () => remoteApi.getThread(id),
      () => localApi.getThread(id),
    ),
  // Same client-minted-id discipline as createThread: mint newThreadId once here, reuse it on the
  // local fallback within this call, so a live→local handoff mid-copy can't leave two threads.
  copyThread: (threadId, { newThreadId, ...rest }) => {
    const b = { ...rest, newThreadId: newThreadId ?? crypto.randomUUID() };
    return via(
      () => remoteApi.copyThread(threadId, b),
      () => localApi.copyThread(threadId, b),
    );
  },
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
  toggleMessageTodo: (threadId, id, done) =>
    via(
      () => remoteApi.toggleMessageTodo(threadId, id, done),
      () => localApi.toggleMessageTodo(threadId, id, done),
    ),
  removeMessageTodo: (threadId, id) =>
    via(
      () => remoteApi.removeMessageTodo(threadId, id),
      () => localApi.removeMessageTodo(threadId, id),
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
  appendAnnotation: (threadId, messageId, body) =>
    via(
      () => remoteApi.appendAnnotation(threadId, messageId, body),
      () => localApi.appendAnnotation(threadId, messageId, body),
    ),
  editAnnotation: (threadId, id, content) =>
    via(
      () => remoteApi.editAnnotation(threadId, id, content),
      () => localApi.editAnnotation(threadId, id, content),
    ),
  deleteAnnotation: (threadId, id) =>
    via(
      () => remoteApi.deleteAnnotation(threadId, id),
      () => localApi.deleteAnnotation(threadId, id),
    ),
};

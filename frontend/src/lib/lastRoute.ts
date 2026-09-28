// The route reopened on launch, remembered per device (localStorage, never synced). A `?thread=` deep
// link in the URL always wins over it (App.tsx), and a stored thread that no longer exists is dropped there.
export type LastRoute = { panel: string; threadId: string | null };

const KEY = "threadz.lastRoute";

export const readLastRoute = (): LastRoute => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return { panel: "index", threadId: null };
    return {
      panel: "panel" in raw && typeof raw.panel === "string" ? raw.panel : "index",
      threadId: "threadId" in raw && typeof raw.threadId === "string" ? raw.threadId : null,
    };
  } catch {
    return { panel: "index", threadId: null };
  }
};

export const saveLastRoute = (patch: Partial<LastRoute>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readLastRoute(), ...patch }));
  } catch {
    // storage blocked: nothing is remembered, nothing breaks
  }
};

// Cross-tab + in-app change signal — the generic half of v1's `lib/sync.ts` (`onChange`/
// `emitChange`), kept as-is: any tab that mutates state broadcasts, every listener (a hook, a
// status store) just re-reads. Nothing here is v1-specific; `lib/data.ts` calls `emitChange()`
// after every write, and `syncEngine.ts` after every successful push/pull.
const channel = "BroadcastChannel" in self ? new BroadcastChannel("threadz") : null;
const local = new EventTarget();

export const onChange = (fn: () => void) => {
  const h = () => fn();
  local.addEventListener("change", h);
  channel?.addEventListener("message", h);
  return () => {
    local.removeEventListener("change", h);
    channel?.removeEventListener("message", h);
  };
};

export const emitChange = () => {
  local.dispatchEvent(new Event("change"));
  channel?.postMessage("change");
};

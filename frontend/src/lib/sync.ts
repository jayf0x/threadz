import { api } from "./api";
import { putThread, putThreads, replaceThreadMessages } from "./db";
import { updateMeta } from "./local";
import { getMode } from "./mode";
import { pullMain } from "./replica";

// Cross-tab + in-app change signal. Any device/tab that mutates state broadcasts;
// listeners re-pull from the mirror.
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

// Live: after refreshing the view, keep the device copy current too (best effort — going
// offline later must find it warm). Local: the device store IS the source, nothing to copy.
const keepReplicaWarm = () => (getMode() === "live" ? pullMain().catch(() => {}) : undefined);

export const pullThreads = async () => {
  const threads = await api.listThreads();
  await putThreads(threads);
  emitChange();
  if (getMode() === "live") {
    await updateMeta(threads).catch(() => {});
    await keepReplicaWarm();
  }
  return threads;
};

export const pullThread = async (id: string) => {
  const { thread, messages } = await api.getThread(id);
  await putThread(thread);
  await replaceThreadMessages(id, messages);
  emitChange();
  await keepReplicaWarm();
  return { thread, messages };
};

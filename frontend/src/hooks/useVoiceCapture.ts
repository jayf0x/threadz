import { useEffect, useSyncExternalStore } from "react";
import {
  checkRecovery,
  dismissRecovery,
  getSnapshot,
  preloadVad,
  recover,
  setSink,
  start,
  stop,
  subscribe,
} from "@/lib/voice/engine";

// Thin React face of the dictation engine (lib/voice/engine.ts). All the audio work
// lives outside React; this hook only
//   • subscribes to the engine's small snapshot (useSyncExternalStore — no effects,
//     no closures over state),
//   • routes finished text to `onText` (must be stable — it's the caret-aware insert),
//   • stops the mic when the thread changes or the composer unmounts.
// Actions are module functions, so they're referentially stable and never stale.
export const useVoiceCapture = (threadId: string, onText: (text: string) => void) => {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    setSink(onText);
    return () => setSink(null);
  }, [onText]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: threadId is a reset key — leaving a thread stops its dictation
  useEffect(() => {
    void checkRecovery();
    // returning voice users get the VAD chunk warm so the first tap is instant
    const warm = getSnapshot().downloaded.length
      ? setTimeout(() => void preloadVad().catch(() => {}), 1500)
      : undefined;
    return () => {
      clearTimeout(warm);
      void stop();
    };
  }, [threadId]);

  return {
    ...state,
    toggle: () => (getSnapshot().phase === "idle" ? start(threadId) : stop()),
    recover,
    dismissRecovery,
  };
};

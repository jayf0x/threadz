import type { MicVAD } from "@ricky0123/vad-web";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSegment,
  assemble,
  discard,
  findUnfinished,
  finishRecording,
  startRecording,
} from "@/lib/voice/recordings";

// ─────────────────────────────────────────────────────────────────────────────
// Long-form voice capture — designed to run for hours on iOS WebKit (Brave/
// Safari) without crashing, bloating memory, or losing data.
//
// Shape (see .research/streaming-voice-plan.md for the why):
//   MicVAD (Silero v5, WASM)                    ← handles mic + resample + VAD
//     onFrameProcessed → own ring of the CURRENT utterance only (≤ MAX_UTTER_S)
//     onSpeechEnd      → whisper worker {final:true} → segment persisted to IDB
//     interim timer    → whisper worker {final:false} → live "partial" line
//   whisper worker (transformers.js whisper-tiny.en, WASM, streamed tokens)
//
// Memory is bounded: in-flight audio is one utterance; the transcript lives in
// IndexedDB (append-only), not React. Nothing here scales with recording length.
//
// iOS reality: WebKit suspends the mic + AudioContext seconds after the screen
// locks or the app backgrounds — no web API prevents this. We hold a Screen Wake
// Lock and flush on `visibilitychange`, but true screen-off recording needs a
// native shell. That limitation is surfaced in the UI, not hidden here.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "Xenova/whisper-tiny.en";
const SAMPLE_RATE = 16000;
const MAX_UTTER_S = 25; // force-cut a monologue this long so ≤ this much is ever unpersisted
const MAX_UTTER_SAMPLES = MAX_UTTER_S * SAMPLE_RATE;
const INTERIM_MS = 2500; // re-decode the in-progress utterance at most this often
// Interims re-run whisper on CPU every INTERIM_MS while you talk — the biggest battery drain.
// Off by default (`live`); the confirmed-segment path doesn't depend on them.

// One long-lived worker for the whole app — the model loads once, not per recording.
let worker: Worker | null = null;
const getWorker = () => {
  if (!worker) worker = new Worker(new URL("../lib/voice/whisper-worker.ts", import.meta.url), { type: "module" });
  return worker;
};

type State = "idle" | "recording" | "loading-model" | "transcribing";
type Job = { audio: Float32Array; seq: number; final: boolean };

export const useVoiceCapture = (model = DEFAULT_MODEL, { live = false } = {}) => {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState(0); // 0–100, model download only
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(""); // current unconfirmed line
  const [tail, setTail] = useState<string[]>([]); // last N confirmed lines, for display only
  const [segmentCount, setSegmentCount] = useState(0); // full count; transcript itself lives in IDB
  const [elapsedMs, setElapsedMs] = useState(0);

  const TAIL_LINES = 40; // React holds only a display tail — hours of transcript stay in IndexedDB
  const [recovery, setRecovery] = useState<{ recordingId: string; lineCount: number; preview: string } | null>(null);

  const micRef = useRef<MicVAD | null>(null);
  const recIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);

  // current-utterance audio (from onFrameProcessed) — reset at every speech start
  const utterRef = useRef<Float32Array[]>([]);
  const utterLenRef = useRef(0);
  const speakingRef = useRef(false);
  const lastInterimRef = useRef(0);

  // one worker, serial decode → a queue so a `final` job is never dropped
  const seqRef = useRef(0); // seq of the utterance currently being captured
  const committedSeqRef = useRef(-1); // highest seq already written — ignore stale results
  const queueRef = useRef<Job[]>([]);
  const busyRef = useRef(false);
  const drainRef = useRef<(() => void) | null>(null); // resolves when stop()'s last job lands

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const forceCutRef = useRef(false);

  // Kick off the model download in the background on mount.
  useEffect(() => {
    getWorker().postMessage({ type: "warmup", model });
  }, [model]);

  // Offer to recover a recording the tab died in the middle of.
  useEffect(() => {
    findUnfinished()
      .then(setRecovery)
      .catch(() => {});
  }, []);

  // Unmount mid-recording (navigated away): stop the mic so it can't keep
  // capturing in the background. The recording stays "unfinished" in IDB, so
  // the confirmed text is offered for recovery next time the app opens.
  useEffect(() => {
    return () => {
      void micRef.current?.destroy().catch(() => {});
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  // recording clock
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [state]);

  const pump = useCallback(() => {
    if (busyRef.current) return;
    const job = queueRef.current.shift();
    if (!job) {
      if (drainRef.current && !busyRef.current) {
        drainRef.current();
        drainRef.current = null;
      }
      return;
    }
    busyRef.current = true;
    const w = getWorker();
    w.postMessage({ type: "transcribe", audio: job.audio, model, seq: job.seq, final: job.final }, [job.audio.buffer]);
  }, [model]);

  const enqueue = useCallback(
    (job: Job) => {
      // interim jobs are disposable — don't pile them up behind a slow decode
      if (!job.final) queueRef.current = queueRef.current.filter((j) => j.final);
      queueRef.current.push(job);
      pump();
    },
    [pump],
  );

  const snapshotUtterance = useCallback((): Float32Array => {
    const merged = new Float32Array(utterLenRef.current);
    let off = 0;
    for (const c of utterRef.current) {
      merged.set(c, off);
      off += c.length;
    }
    return merged;
  }, []);

  // ── worker messages ────────────────────────────────────────────────────────
  useEffect(() => {
    const w = getWorker();
    const onMessage = (
      e: MessageEvent<
        | { type: "progress"; progress: number }
        | { type: "ready" }
        | { type: "partial"; seq: number; text: string; final: boolean }
        | { type: "result"; seq: number; text: string; final: boolean }
        | { type: "error"; error: string }
      >,
    ) => {
      const d = e.data;
      if (d.type === "progress") {
        if (state === "idle" || state === "recording") setState("loading-model");
        setProgress(Math.round(d.progress ?? 0));
        return;
      }
      if (d.type === "ready") {
        setState((s) => (s === "loading-model" ? "recording" : s));
        return;
      }
      if (d.type === "error") {
        setError(d.error);
        busyRef.current = false;
        pump();
        return;
      }
      if (d.type === "partial") {
        if (d.seq > committedSeqRef.current) setPartial(d.text);
        return;
      }
      // result
      busyRef.current = false;
      if (state === "loading-model") setState(recIdRef.current ? "recording" : "idle");
      if (d.final && d.seq > committedSeqRef.current) {
        committedSeqRef.current = d.seq;
        setPartial("");
        if (d.text && recIdRef.current) {
          void appendSegment(recIdRef.current, d.seq, d.text);
          setTail((prev) => [...prev, d.text].slice(-TAIL_LINES));
          setSegmentCount((n) => n + 1);
        }
      }
      pump();
    };
    w.addEventListener("message", onMessage);
    return () => w.removeEventListener("message", onMessage);
  }, [state, pump]);

  // ── wake lock ──────────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      /* not supported / denied — the UI already tells the user to keep the screen on */
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        // leaving — flush the in-progress utterance while we still have a moment
        void micRef.current?.pause().catch(() => {});
        return;
      }
      if (recIdRef.current) {
        void acquireWakeLock();
        void micRef.current?.start().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onVisible);
    };
  }, [acquireWakeLock]);

  // ── controls ───────────────────────────────────────────────────────────────
  const start = useCallback(
    async (threadId: string) => {
      if (state !== "idle" && state !== "loading-model") return;
      setError(null);
      setPartial("");
      setTail([]);
      setSegmentCount(0);
      setElapsedMs(0);
      setRecovery(null);
      seqRef.current = 0;
      committedSeqRef.current = -1;
      utterRef.current = [];
      utterLenRef.current = 0;
      speakingRef.current = false;

      try {
        recIdRef.current = await startRecording(threadId);
        startedAtRef.current = Date.now();

        // iOS 17+: keep TTS/other audio off the earpiece while the mic is open.
        try {
          const audioSession = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
          if (audioSession) audioSession.type = "play-and-record";
        } catch {}
        await acquireWakeLock();

        // Lazy: keeps vad-web + onnxruntime glue out of the startup bundle.
        const { MicVAD: Vad } = await import("@ricky0123/vad-web");
        micRef.current = await Vad.new({
          model: "v5",
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          submitUserSpeechOnPause: true, // pause() flushes the current utterance as a segment
          redemptionMs: 900, // end a segment ~0.9s after speech stops → faster sentence-by-sentence
          minSpeechMs: 250,
          ortConfig: (ort) => {
            ort.env.wasm.numThreads = 1; // no cross-origin isolation → single thread
            ort.env.logLevel = "error";
          },
          onSpeechStart: () => {
            speakingRef.current = true;
            utterRef.current = [];
            utterLenRef.current = 0;
            lastInterimRef.current = Date.now();
          },
          onFrameProcessed: (_probs, frame) => {
            if (!speakingRef.current) return;
            utterRef.current.push(frame.slice());
            utterLenRef.current += frame.length;

            if (utterLenRef.current >= MAX_UTTER_SAMPLES && !forceCutRef.current) {
              // monologue with no pause — bounce the VAD so it emits this segment
              // (submitUserSpeechOnPause) and its internal buffer resets too.
              forceCutRef.current = true;
              void (async () => {
                try {
                  await micRef.current?.pause();
                  await micRef.current?.start();
                } catch {}
                forceCutRef.current = false;
              })();
              return;
            }
            if (live && Date.now() - lastInterimRef.current >= INTERIM_MS) {
              lastInterimRef.current = Date.now();
              enqueue({ audio: snapshotUtterance(), seq: seqRef.current, final: false });
            }
          },
          onSpeechEnd: (audio) => {
            speakingRef.current = false;
            utterRef.current = [];
            utterLenRef.current = 0;
            const clip = audio.length > MAX_UTTER_SAMPLES ? audio.slice(-MAX_UTTER_SAMPLES) : audio;
            enqueue({ audio: clip, seq: seqRef.current++, final: true });
          },
          onVADMisfire: () => {
            speakingRef.current = false;
            setPartial("");
          },
        });

        setState((s) => (s === "loading-model" ? s : "recording"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /getUserMedia|permission|NotAllowed|secure/i.test(msg)
            ? "Mic unavailable. On iOS the app must be served over HTTPS (or localhost) and mic permission granted."
            : msg,
        );
        if (recIdRef.current) await discard(recIdRef.current).catch(() => {});
        recIdRef.current = null;
        setState("idle");
      }
    },
    [state, live, acquireWakeLock, enqueue, snapshotUtterance],
  );

  const stop = useCallback(async (): Promise<string> => {
    const recId = recIdRef.current;
    if (!recId) return "";
    setState("transcribing");

    // flush whatever is mid-utterance, then wait for the decode queue to drain
    try {
      await micRef.current?.pause();
    } catch {}
    if (busyRef.current || queueRef.current.length) {
      await new Promise<void>((resolve) => {
        // don't hang forever on a wedged / still-downloading decode
        const t = setTimeout(resolve, 45000);
        drainRef.current = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
    try {
      await micRef.current?.destroy();
    } catch {}
    micRef.current = null;

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    const text = await assemble(recId);
    await finishRecording(recId);
    recIdRef.current = null;
    speakingRef.current = false;
    setPartial("");
    setState("idle");
    setRecovery(null);
    return text.trim();
  }, []);

  const recoverText = useCallback(async (): Promise<string> => {
    if (!recovery) return "";
    const text = await assemble(recovery.recordingId);
    await finishRecording(recovery.recordingId);
    setRecovery(null);
    return text.trim();
  }, [recovery]);

  const discardRecovery = useCallback(async () => {
    if (recovery) await discard(recovery.recordingId).catch(() => {});
    setRecovery(null);
  }, [recovery]);

  return {
    state,
    progress,
    error,
    partial,
    tail, // last ~40 confirmed lines, for the live display only
    segmentCount,
    elapsedMs,
    recovery,
    start,
    stop,
    recoverText,
    discardRecovery,
  };
};

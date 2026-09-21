import { cachedModelIds, DEFAULT_MODEL, findLanguage, findModel } from "./models";
import { appendSegment, assemble, discard, findUnfinished, finishRecording, startRecording } from "./recordings";
import { cleanTranscript } from "./text";
import type { WorkerIn, WorkerOut } from "./whisper-worker";

// ─────────────────────────────────────────────────────────────────────────────
// Dictation engine. A plain module, not React state: the audio path (mic frames,
// worker messages, timers) mutates module variables and only *publishes* a small
// snapshot when something a human can see changes. React subscribes with
// useSyncExternalStore (see hooks/useVoiceCapture.ts), so there are no stale
// closures, no effect re-subscribe churn, and no per-frame renders.
//
//   mic ─ AudioWorklet (vad-web, Silero v5) ─ onSpeechEnd(utterance) ─┐
//                                                                     ▼
//   whisper worker (serial) ── partial tokens ──▶ snapshot.partial   sink(text)
//                           └─ result ─▶ IndexedDB segment log ─────▶ (the textarea)
//
// Cost model — why this is cheap on a phone:
//  • While you're silent only the 32ms Silero frame runs (the vad-web standard).
//  • Whisper runs once per utterance, never on a timer. No interim re-decodes.
//  • The mic, AudioContext and wake lock exist only while dictating; the whisper
//    worker is terminated after IDLE_UNLOAD_MS of not being used.
//  • The level meter is one callback into a DOM ref — zero React renders.
// Memory is bounded: in flight is at most one utterance (≤ MAX_UTTER_S) plus the
// decodes already queued; the text itself lives in the textarea and IndexedDB.
//
// iOS reality (backlog): WebKit suspends the mic seconds after the screen locks.
// We hold a Screen Wake Lock and release the mic when the page is hidden.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_UTTER_S = 25; // force-cut a monologue here so ≤ this much audio is ever unpersisted
const SAMPLE_RATE = 16000;
const REDEMPTION_MS = 800; // silence that ends an utterance — lower = snappier, higher = fewer mid-sentence cuts
const IDLE_UNLOAD_MS = 3 * 60_000; // free the model's RAM after this long unused
const VAD_BASE = `${import.meta.env.BASE_URL}vad/`; // self-hosted VAD assets (vite.config.ts copies them); base-aware for sub-path hosting
const PREFS_KEY = "threadz.voice.prefs";
const DOWNLOADED_KEY = "threadz.voice.downloaded"; // hint, used only where Cache Storage is unavailable
const WEB_CACHE = "transformers-cache"; // the Cache Storage bucket transformers.js writes model files to
// ponytail: worker is terminated, not paused — reload from HTTP cache costs a few seconds. Raise
// IDLE_UNLOAD_MS if that annoys.

export type Phase = "idle" | "starting" | "listening";
export type ModelStatus = "idle" | "loading" | "ready" | "error";
export type Prefs = { model: string; language: string };
export type Recovery = { recordingId: string; lineCount: number; preview: string };

export type VoiceState = {
  phase: Phase;
  model: { id: string; status: ModelStatus; pct: number };
  downloaded: string[]; // model ids in the browser cache (Cache Storage; localStorage hint as fallback)
  prefs: Prefs;
  partial: string; // tokens of the utterance currently being decoded
  pending: number; // decodes in flight (mic off + pending>0 = "finishing")
  error: string | null;
  recovery: Recovery | null;
};

// ── store ────────────────────────────────────────────────────────────────────
const read = <T>(key: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? "null") } as T;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const initialPrefs = (): Prefs => {
  const p = read<Prefs>(PREFS_KEY, { model: DEFAULT_MODEL, language: "auto" });
  return { model: findModel(p.model).id, language: findLanguage(p.language) };
};

let state: VoiceState = (() => {
  const prefs = initialPrefs();
  let downloaded: string[] = [];
  try {
    const d = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? "[]");
    if (Array.isArray(d)) downloaded = d;
  } catch {}
  return {
    phase: "idle",
    model: { id: prefs.model, status: "idle", pct: 0 },
    downloaded,
    prefs,
    partial: "",
    pending: 0,
    error: null,
    recovery: null,
  };
})();

const subs = new Set<() => void>();
const set = (patch: Partial<VoiceState>) => {
  state = { ...state, ...patch };
  for (const f of subs) f();
};
export const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const getSnapshot = () => state;

// Non-React outputs: finished text → wherever the caret is; audio level → a DOM ref.
let sink: ((text: string) => void) | null = null;
export const setSink = (f: ((text: string) => void) | null) => {
  sink = f;
};
let levelSink: ((level: number, speaking: boolean) => void) | null = null;
export const setLevelSink = (f: ((level: number, speaking: boolean) => void) | null) => {
  levelSink = f;
};

// ── worker + model ───────────────────────────────────────────────────────────
let worker: Worker | null = null;
let unloadTimer: ReturnType<typeof setTimeout> | undefined;

const getWorker = (): Worker => {
  if (!worker) {
    const w = new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (worker === w) onWorker(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault();
      if (worker !== w) return;
      dropWorker(); // a dead worker must not be reused: the next load would wait on it forever
      onWorker({ type: "fail", model: state.model.id, error: e.message || "Speech worker crashed" });
    };
    worker = w;
  }
  return worker;
};

// Terminate the worker. Decodes that were on it are gone, so settle them here or `pending` sticks.
const dropWorker = () => {
  worker?.terminate();
  worker = null;
  if (state.pending) set({ pending: 0, partial: "" });
  for (const r of recs.values()) {
    r.inflight = 0;
    settle(r);
  }
};

const send = (m: WorkerIn, transfer: Transferable[] = []) => {
  clearTimeout(unloadTimer);
  getWorker().postMessage(m, transfer);
};

const scheduleUnload = () => {
  clearTimeout(unloadTimer);
  if (state.phase !== "idle" || state.pending || state.model.status !== "ready") return;
  unloadTimer = setTimeout(() => {
    dropWorker();
    set({ model: { ...state.model, status: "idle", pct: 0 } });
  }, IDLE_UNLOAD_MS);
};

const loadModel = (id: string) => {
  const m = state.model;
  if (m.id === id && (m.status === "loading" || m.status === "ready")) return;
  // The worker handles messages one at a time, so a load queued behind another model's download
  // would wait for all of it. Replace it instead: kill that worker (Cache Storage only ever holds
  // whole files). With decodes queued behind the load we keep the worker and this load waits its turn.
  if (m.status === "loading" && m.id !== id && !state.pending) dropWorker();
  set({ model: { id, status: "loading", pct: 0 } });
  send({ type: "load", model: id });
};

export const setModel = (id: string) => {
  const prefs = { ...state.prefs, model: findModel(id).id };
  write(PREFS_KEY, prefs);
  set({ prefs, error: null });
  loadModel(prefs.model);
};

export const setLanguage = (language: string) => {
  const prefs = { ...state.prefs, language: findLanguage(language) };
  write(PREFS_KEY, prefs);
  set({ prefs });
};

// ── recordings in flight ─────────────────────────────────────────────────────
// A recording outlives its mic: after stop, decodes still land. `inflight` counts them;
// once the mic is closed and it hits 0 the recording is finished. If text arrived with
// nobody listening (Composer unmounted) the recording stays "unfinished" so the
// recover banner offers it next time.
type Rec = { id: string; seq: number; inflight: number; closed: boolean; orphan: boolean };
const recs = new Map<string, Rec>();
let current: Rec | null = null;

const settle = (r: Rec) => {
  if (!r.closed || r.inflight > 0) return;
  recs.delete(r.id);
  if (r.orphan) void checkRecovery();
  else void finishRecording(r.id).catch(() => {});
  scheduleUnload();
};

const jobDone = (recId: string) => {
  const r = recs.get(recId);
  set({ pending: Math.max(0, state.pending - 1), ...(state.pending <= 1 ? { partial: "" } : {}) });
  if (r) {
    r.inflight--;
    settle(r);
  }
};

// Cache Storage is the truth for "downloaded"; where it's unavailable (insecure context, private
// mode) `downloaded` stays the localStorage hint.
const refreshDownloaded = async () => {
  try {
    const keys = await (await caches.open(WEB_CACHE)).keys();
    const downloaded = cachedModelIds(keys.map((r) => r.url));
    write(DOWNLOADED_KEY, downloaded);
    set({ downloaded });
  } catch {}
};

const onWorker = (m: WorkerOut) => {
  switch (m.type) {
    case "progress":
      if (m.model === state.model.id && state.model.status === "loading")
        set({ model: { ...state.model, pct: m.pct } });
      return;
    case "ready": {
      const downloaded = state.downloaded.includes(m.model) ? state.downloaded : [...state.downloaded, m.model];
      write(DOWNLOADED_KEY, downloaded);
      set(
        m.model === state.model.id ? { downloaded, model: { id: m.model, status: "ready", pct: 100 } } : { downloaded },
      );
      void refreshDownloaded();
      scheduleUnload();
      return;
    }
    case "partial":
      set({ partial: m.text });
      return;
    case "result": {
      const r = recs.get(m.recId);
      const text = cleanTranscript(m.text);
      if (state.error) set({ error: null });
      if (text && r) {
        void appendSegment(r.id, m.seq, text).catch(() => {}); // durable first; best-effort
        if (sink) sink(text);
        else r.orphan = true;
      }
      jobDone(m.recId);
      return;
    }
    case "fail":
      if (m.recId) {
        jobDone(m.recId);
        set({ error: state.error ?? "Couldn't transcribe that part." });
      } else if (m.model === state.model.id) {
        set({
          model: { ...state.model, status: "error", pct: 0 },
          error: navigator.onLine
            ? "Couldn't load the speech model."
            : "Speech model isn't downloaded yet — go online once to fetch it.",
        });
        if (state.phase !== "idle") void stop(); // nothing could be transcribed; don't keep listening
      }
      return;
  }
};

// ── mic ──────────────────────────────────────────────────────────────────────
type Vad = import("@ricky0123/vad-web").MicVAD;
let vadModule: Promise<typeof import("@ricky0123/vad-web")> | null = null;
export const preloadVad = () => {
  vadModule ??= import("@ricky0123/vad-web");
  return vadModule;
};

let vad: Vad | null = null;
let stream: MediaStream | null = null;
let startToken = 0; // bumped by stop() so a start that's still awaiting knows it was cancelled
let speaking = false;
let utterSamples = 0;
let cutting = false;
let frameCount = 0;
let wakeLock: WakeLockSentinel | null = null;

const acquireStream = async (): Promise<MediaStream> => {
  const s = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  // the OS took the mic (call, Siri, another app) — stop cleanly instead of "listening" to silence
  s.getAudioTracks()[0]?.addEventListener("ended", () => {
    if (state.phase === "listening" && !document.hidden) {
      set({ error: "Microphone was interrupted." });
      void stop();
    }
  });
  stream = s;
  return s;
};

const releaseStream = (s: MediaStream | null = stream) => {
  for (const t of s?.getTracks() ?? []) t.stop();
  if (s === stream) stream = null;
};

const takeWakeLock = async () => {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {} // unsupported / denied — dictation still works, the screen may just sleep
};

const submit = (r: Rec, audio: Float32Array) => {
  r.inflight++;
  set({ pending: state.pending + 1 });
  const { model, language } = state.prefs;
  send({ type: "transcribe", model, language, audio, recId: r.id, seq: r.seq++ }, [audio.buffer]);
};

// Monologue with no pause: pause()+start() makes the VAD emit what it has (submitUserSpeechOnPause)
// and reset. Streams stay open (see pauseStream below), so this is instant — no re-prompt, no gap.
const forceCut = async () => {
  if (cutting || !vad) return;
  cutting = true;
  try {
    await vad.pause();
    await vad.start();
  } catch {
  } finally {
    cutting = false;
  }
};

// Hidden page → release the mic (and flush the utterance); visible again → take it back.
const onVisibility = async () => {
  if (!vad || state.phase !== "listening") return;
  if (document.hidden) {
    try {
      await vad.pause();
    } catch {}
    releaseStream();
    return;
  }
  try {
    await vad.start(); // resumeStream re-acquires the mic
    await takeWakeLock();
  } catch {
    set({ error: "Microphone was interrupted." });
    void stop();
  }
};

const micError = (e: unknown): string => {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked for this site.";
  if (name === "NotFoundError") return "No microphone found.";
  return e instanceof Error ? e.message : "Couldn't start the microphone.";
};

// Boots run one at a time: a stop→start inside the spin-up window must not let the old
// attempt's cleanup release the new attempt's mic.
let booting: Promise<void> = Promise.resolve();

export const start = (threadId: string): Promise<void> => {
  if (state.phase !== "idle") return Promise.resolve();
  if (!navigator.mediaDevices?.getUserMedia) {
    set({ error: "Microphone needs HTTPS (or localhost) — this address is blocked by the browser." });
    return Promise.resolve();
  }
  const token = ++startToken;
  set({ phase: "starting", error: null, partial: "" });
  booting = booting.then(() => boot(threadId, token));
  return booting;
};

const boot = async (threadId: string, token: number) => {
  const cancelled = () => token !== startToken;
  if (cancelled()) return; // stopped before we even began
  clearTimeout(unloadTimer);
  loadModel(state.prefs.model); // downloads/loads while the mic spins up; utterances queue behind it

  let rec: Rec | null = null;
  let mic: Vad | null = null;
  try {
    const [{ MicVAD }, id] = await Promise.all([
      preloadVad(),
      startRecording(threadId).catch(() => crypto.randomUUID()), // no IDB (private mode) ≠ no dictation
    ]);
    const r: Rec = { id, seq: 0, inflight: 0, closed: false, orphan: false };
    rec = r;
    recs.set(id, r);
    current = r;
    speaking = false;
    utterSamples = 0;
    frameCount = 0;

    mic = await MicVAD.new({
      model: "v5",
      baseAssetPath: VAD_BASE,
      onnxWASMBasePath: VAD_BASE,
      submitUserSpeechOnPause: true, // pause()/destroy() flush the in-progress utterance
      redemptionMs: REDEMPTION_MS,
      minSpeechMs: 250,
      getStream: acquireStream,
      pauseStream: async () => {}, // keep the mic open across force-cuts; we release it ourselves
      resumeStream: async (s) => (s.getTracks().every((t) => t.readyState === "live") ? s : acquireStream()),
      ortConfig: (ort) => {
        ort.env.wasm.numThreads = 1; // no cross-origin isolation → single thread
        ort.env.logLevel = "error";
      },
      onSpeechStart: () => {
        speaking = true;
        utterSamples = 0;
      },
      onSpeechEnd: (audio) => {
        speaking = false;
        utterSamples = 0;
        submit(r, audio);
      },
      onVADMisfire: () => {
        speaking = false;
        utterSamples = 0;
      },
      onFrameProcessed: (probs, frame) => {
        if (speaking) {
          utterSamples += frame.length;
          if (utterSamples >= MAX_UTTER_S * SAMPLE_RATE) void forceCut();
        }
        // every other frame (~16 Hz) is plenty for a meter
        if (levelSink && (frameCount++ & 1) === 0) {
          let sum = 0;
          for (const s of frame) sum += s * s;
          levelSink(Math.min(1, Math.sqrt(Math.sqrt(sum / frame.length) * 12)), probs.isSpeech > 0.5);
        }
      },
    });

    if (cancelled()) throw new DOMException("cancelled", "AbortError");
    vad = mic;
    await takeWakeLock();
    document.addEventListener("visibilitychange", onVisibility);
    set({ phase: "listening" });
  } catch (e) {
    if (mic) await mic.destroy().catch(() => {});
    releaseStream();
    if (rec) {
      current = null;
      rec.closed = true;
      if (rec.inflight === 0) {
        recs.delete(rec.id);
        void discard(rec.id).catch(() => {});
      }
    }
    if (!cancelled()) set({ phase: "idle", error: micError(e) });
  }
};

// Instant from the user's side: the mic is released and the UI is idle before anything
// is awaited. Decodes already queued (including the flushed last utterance) still land.
export const stop = async () => {
  startToken++; // cancels a start() that's still spinning up
  const mic = vad;
  const rec = current;
  const held = stream; // this session's mic: a start() during the awaits below owns a new stream
  stream = null;
  vad = null;
  current = null;
  speaking = false;
  if (state.phase !== "idle") set({ phase: "idle" });
  document.removeEventListener("visibilitychange", onVisibility);
  void wakeLock?.release().catch(() => {});
  wakeLock = null;

  try {
    await mic?.destroy(); // pause() inside → flushes the last utterance through onSpeechEnd → submit
  } catch {}
  releaseStream(held);
  if (rec) {
    rec.closed = true;
    settle(rec);
  }
  scheduleUnload();
};

// ── recovery (a tab that died mid-recording) ─────────────────────────────────
export const checkRecovery = async () => {
  if (state.phase !== "idle" || recs.size) return; // findUnfinished() discards empty rows — never race a live one
  try {
    set({ recovery: await findUnfinished() });
  } catch {}
};

export const recover = async (): Promise<string> => {
  const r = state.recovery;
  if (!r) return "";
  const text = await assemble(r.recordingId);
  await finishRecording(r.recordingId).catch(() => {});
  set({ recovery: null });
  return text;
};

export const dismissRecovery = async () => {
  if (state.recovery) await discard(state.recovery.recordingId).catch(() => {});
  set({ recovery: null });
};

export const clearError = () => set({ error: null });

void refreshDownloaded();

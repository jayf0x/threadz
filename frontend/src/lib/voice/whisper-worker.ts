/// <reference lib="webworker" />

import { env, type PipelineType, pipeline, TextStreamer } from "@huggingface/transformers";
import { errorMessage } from "@/lib/errors";

// On-device transcription in a worker so decoding never janks the UI. One pipeline is
// resident at a time; switching models disposes the old one. Messages are handled
// strictly one after another (`chain`), so the main thread can post work without
// tracking a busy flag, and a model swap can never pull the pipeline out from under
// a running decode.
//
// Input is one VAD-trimmed utterance (≤ ~25s) per `transcribe`. Tokens stream back as
// `partial`; the finished text is a `result`. Nothing here loops or polls.
env.allowLocalModels = false;

// biome-ignore lint/suspicious/noExplicitAny: transformers.js pipeline union type is unrepresentable
type Asr = any;

export type WorkerIn =
  | { type: "load"; model: string }
  | { type: "transcribe"; model: string; language: string; audio: Float32Array; recId: string; seq: number };

export type WorkerOut =
  | { type: "progress"; model: string; pct: number }
  | { type: "ready"; model: string }
  | { type: "partial"; recId: string; seq: number; text: string }
  | { type: "result"; recId: string; seq: number; text: string }
  | { type: "fail"; error: string; model?: string; recId?: string; seq?: number };

const post = (m: WorkerOut) => self.postMessage(m);

let current: { model: string; asr: Promise<Asr> } | null = null;
// A model whose load just failed: queued jobs for it fail fast instead of each
// re-attempting a multi-MB download. An explicit `load` clears it (retry).
let broken: string | null = null;

const getAsr = (model: string): Promise<Asr> => {
  if (current?.model === model) return current.asr;
  const old = current;
  void old?.asr.then((a) => a.dispose?.()).catch(() => {});

  // Each model ships as several files; report one blended percentage, never a per-file
  // 0→100 sawtooth. Monotonic, and held under 100 until the pipeline actually resolves.
  const files = new Map<string, { loaded: number; total: number }>();
  let high = 0;
  const asr = pipeline("automatic-speech-recognition" as PipelineType, model, {
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      high = Math.max(high, Math.min(99, Math.round((loaded / total) * 100)));
      post({ type: "progress", model, pct: high });
    },
  });
  current = { model, asr };
  // a failed load must not be cached — the next attempt has to be able to retry
  asr.catch(() => {
    if (current?.asr === asr) current = null;
  });
  return asr;
};

const handle = async (m: WorkerIn) => {
  if (m.type === "load") {
    if (broken === m.model) broken = null;
    try {
      await getAsr(m.model);
      post({ type: "ready", model: m.model });
    } catch (err) {
      broken = m.model;
      post({ type: "fail", model: m.model, error: errorMessage(err) });
    }
    return;
  }

  const { audio, recId, seq } = m;
  try {
    if (broken === m.model) throw new Error("Speech model unavailable");
    const asr = await getAsr(m.model);
    let acc = "";
    const streamer = new TextStreamer(asr.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        acc += text;
        post({ type: "partial", recId, seq, text: acc.trim() });
      },
    });
    // `.en` checkpoints reject language/task; multilingual ones auto-detect when omitted.
    const opts: Record<string, unknown> = { streamer, chunk_length_s: 30 };
    if (!m.model.endsWith(".en")) {
      opts.task = "transcribe";
      if (m.language !== "auto") opts.language = m.language;
    }
    const out = await asr(audio, opts);
    const text: string = (Array.isArray(out) ? out.map((o: { text: string }) => o.text).join(" ") : out.text).trim();
    post({ type: "result", recId, seq, text });
  } catch (err) {
    post({ type: "fail", recId, seq, error: errorMessage(err) });
  }
};

let chain: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<WorkerIn>) => {
  chain = chain.then(() => handle(e.data));
};

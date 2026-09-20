/// <reference lib="webworker" />
import { env, type PipelineType, pipeline, TextStreamer } from "@huggingface/transformers";

// On-device transcription in a worker so decoding doesn't jank the UI. The
// pipeline (model + wasm) loads once on first use and is reused for every
// utterance. Model size is swappable via the `model` field — test tiny vs base
// on a real phone before committing (backlog).
//
// The hook feeds this one VAD-trimmed utterance at a time (bounded ~25s), never
// a growing buffer. Each call streams tokens back as `partial` for live
// feedback, then a final `result`. `final` distinguishes an interim re-decode
// of an in-progress utterance from its committed version.
env.allowLocalModels = false;

// biome-ignore lint/suspicious/noExplicitAny: transformers.js pipeline union type is unrepresentable
type Asr = any;

let current: { model: string; asr: Promise<Asr> } | null = null;

const getAsr = (model: string): Promise<Asr> => {
  if (current?.model !== model) {
    current = {
      model,
      asr: pipeline("automatic-speech-recognition" as PipelineType, model, {
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          self.postMessage({ type: "progress", status: p.status, progress: p.progress ?? 0, file: p.file });
        },
      }),
    };
  }
  return current.asr;
};

type In =
  | { type: "warmup"; model: string }
  | { type: "transcribe"; audio: Float32Array; model: string; seq: number; final: boolean };

self.onmessage = async (e: MessageEvent<In>) => {
  try {
    const asr = await getAsr(e.data.model);
    if (e.data.type === "warmup") {
      self.postMessage({ type: "ready" });
      return;
    }

    const { audio, seq, final } = e.data;
    let acc = "";
    const streamer = new TextStreamer(asr.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        acc += text;
        self.postMessage({ type: "partial", seq, text: acc.trim(), final });
      },
    });

    // No chunking: the utterance is already short. Greedy decode, streamed.
    const out = await asr(audio, { streamer });
    const text: string = (Array.isArray(out) ? out.map((o: { text: string }) => o.text).join(" ") : out.text).trim();
    self.postMessage({ type: "result", seq, text, final });
  } catch (err) {
    self.postMessage({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};

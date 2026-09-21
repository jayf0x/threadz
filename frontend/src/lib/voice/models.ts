// The whole "add a model / add a language" surface: append a row here, nothing else changes.
// All are Xenova ONNX whisper builds that transformers.js runs on-device (WASM, q8).

export type VoiceModel = { id: string; label: string; note: string; mb: number; multilingual: boolean };

export const MODELS: [VoiceModel, ...VoiceModel[]] = [
  { id: "Xenova/whisper-tiny.en", label: "Tiny", note: "English · fastest", mb: 40, multilingual: false },
  { id: "Xenova/whisper-base.en", label: "Base", note: "English · more accurate", mb: 80, multilingual: false },
  { id: "Xenova/whisper-tiny", label: "Tiny", note: "Multilingual · fastest", mb: 40, multilingual: true },
  { id: "Xenova/whisper-base", label: "Base", note: "Multilingual · balanced", mb: 80, multilingual: true },
  { id: "Xenova/whisper-small", label: "Small", note: "Multilingual · best, heavy", mb: 250, multilingual: true },
];

export const DEFAULT_MODEL = MODELS[0].id;

// "auto" lets whisper detect the language per utterance (multilingual models only).
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "nl", label: "Dutch" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export const findModel = (id: string): VoiceModel => MODELS.find((m) => m.id === id) ?? MODELS[0];

// A stored/unknown code falls back to "auto": whisper throws on a language it doesn't know.
export const findLanguage = (code: unknown): string => LANGUAGES.find((l) => l.code === code)?.code ?? "auto";

// Which models are fully in transformers.js's Cache Storage, from the cached request URLs.
// Whisper needs both the encoder and the merged decoder; one alone is a half-finished download.
export const cachedModelIds = (urls: string[]): string[] =>
  MODELS.filter((m) =>
    ["encoder_model", "decoder_model_merged"].every((f) =>
      urls.some((u) => u.includes(`/${m.id}/resolve/`) && u.includes(`/onnx/${f}`)),
    ),
  ).map((m) => m.id);

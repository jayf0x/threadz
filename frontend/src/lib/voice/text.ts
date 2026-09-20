// Pure text helpers for dictation — no DOM, no React, so the caret rules are testable.

// Whisper emits "[BLANK_AUDIO]", "(music)", "*sigh*", "♪ … ♪" for non-speech. Strip those;
// if no letters/digits survive, the utterance was noise.
export const cleanTranscript = (raw: string): string => {
  const text = raw
    .replace(/[[(*♪][^\])*♪]*[\])*♪]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
};

// Dictated `text` with only the spaces that are missing, given the character(s) just
// before and after the insertion point: a leading one if it would otherwise glue onto the
// previous word, a trailing one if it would glue onto the next word (but never before
// closing punctuation or at the very end — the user may want to type "." next).
// Works on windows, so a rich-text editor can pass one char either side.
export const padForInsert = (before: string, after: string, text: string): { text: string; caretOffset: number } => {
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,;:!?)\]}]/.test(after) ? " " : "";
  return { text: lead + text + trail, caretOffset: lead.length + text.length };
};

// Insert into a plain string at `caret`. Returns the new value and the caret just after the text.
export const spliceAtCaret = (value: string, caret: number, text: string): { value: string; caret: number } => {
  const at = Math.max(0, Math.min(caret, value.length));
  const pad = padForInsert(value.slice(0, at), value.slice(at), text);
  return { value: value.slice(0, at) + pad.text + value.slice(at), caret: at + pad.caretOffset };
};

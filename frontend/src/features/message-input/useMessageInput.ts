import { useRef } from "react";
import type { MarkdownEditorHandle } from "@/features/editor";
import { useImageAttach } from "@/features/editor";
import { useDraft } from "./useDraft";

// The generic "type markdown, attach images, hit send" state behind `MessageInput`: the draft
// (persisted per `draftKey`), the editor handle, image attach, and a submit that clears only the
// text it sent — anything typed (or, in the composer, dictated) while the send was in flight stays.
export const useMessageInput = (draftKey: string, busy: boolean, onSubmit: (text: string) => Promise<boolean>) => {
  const [draft, setDraft] = useDraft(draftKey);
  const editor = useRef<MarkdownEditorHandle>(null);
  const { attach, error: imageError } = useImageAttach(editor);
  const sending = useRef(false);

  // Returns the text left in the box after a successful send (e.g. speech that landed mid-flight),
  // or null if nothing was sent (empty, busy, already sending, or the caller rejected it).
  const submit = async (): Promise<string | null> => {
    const text = (editor.current?.getMarkdown() ?? draft).trim();
    if (!text || busy || sending.current) return null;
    sending.current = true;
    try {
      if (!(await onSubmit(text))) return null;
      const raw = (editor.current?.getMarkdown() ?? "").trim();
      const at = raw.indexOf(text);
      const rest = at < 0 ? raw : (raw.slice(0, at) + raw.slice(at + text.length)).trim();
      editor.current?.setMarkdown(rest);
      setDraft(rest);
      return rest;
    } finally {
      sending.current = false;
    }
  };

  // Programmatic insert (dictation, in the composer): into the editor if it's mounted, else
  // straight into the draft so nothing is lost before the editor loads.
  const insertAtCaret = (text: string) => {
    if (!editor.current?.insertAtCaret(text)) setDraft((d) => (d ? `${d} ${text}` : text));
  };

  // Peek at the current text without sending it — for a sibling action (composer's "copy
  // thread from here") that delivers it a different way. `clear` only runs on that action's
  // own success, so a failure leaves the draft exactly as typed.
  const getText = () => (editor.current?.getMarkdown() ?? draft).trim();
  const clear = () => {
    editor.current?.setMarkdown("");
    setDraft("");
  };

  const focus = () => editor.current?.focus();

  return { draft, setDraft, editor, attach, imageError, submit, insertAtCaret, getText, clear, focus };
};

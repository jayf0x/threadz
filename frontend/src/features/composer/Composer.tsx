import { CornerDownLeft, ImagePlus, Mic, Settings2, Square } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/features/editor";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { addImage } from "@/lib/imageSync";
import type { VoiceState } from "@/lib/voice/engine";
import { useDraft } from "./useDraft";
import { useVoiceCapture } from "./useVoiceCapture";
import { VoiceMeter } from "./VoiceMeter";
import { VoiceSettings } from "./VoiceSettings";

type Mode = "note" | "ask";
const MODES: { value: Mode; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "ask", label: "Ask Claude" },
];

// One quiet line under the box. Priority: what's wrong > what's blocking > what's being decoded > mic state.
const voiceStatus = (v: VoiceState): { text: string; tone: "error" | "ghost" | "quiet" } | null => {
  if (v.error) return { text: v.error, tone: "error" };
  const m = v.model;
  if (m.status === "loading" && (v.phase !== "idle" || v.pending))
    return {
      text: v.downloaded.includes(m.id) ? "Loading speech model…" : `Downloading speech model… ${m.pct}%`,
      tone: "quiet",
    };
  if (v.partial) return { text: v.partial, tone: "ghost" };
  if (v.phase === "starting") return { text: "Starting microphone…", tone: "quiet" };
  if (v.phase === "listening") return { text: "Listening…", tone: "quiet" };
  if (v.pending) return { text: "Transcribing…", tone: "quiet" };
  return null;
};

// The capture line. Owns the draft + voice; the parent only hears "add this" / "ask this".
export const Composer = ({
  threadId,
  busy,
  canAsk,
  onNote,
  onAsk,
}: {
  threadId: string;
  busy: boolean;
  canAsk: boolean; // Claude runs on the backend; not available in local mode
  onNote: (text: string, meta: { voice: true } | null) => Promise<boolean>;
  onAsk: (prompt: string, commit: boolean) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useDraft(threadId);
  const fromVoice = useRef(false); // a ref, not state: editing must not un-flag dictated text
  const [picked, setMode] = useState<Mode>("note");
  const mode = canAsk ? picked : "note";
  const sending = useRef(false);
  const [commit, setCommit] = useState(true);
  const [showVoice, setShowVoice] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // A picked/pasted/dropped photo is compressed and stored on this device, then dropped into the note at the caret.
  const attach = async (files: Iterable<File>) => {
    setImageError(null);
    for (const file of files) {
      try {
        editor.current?.insertImage(await addImage(file));
      } catch (e) {
        setImageError(errorMessage(e));
      }
    }
  };

  // Finished dictation lands at the editor's caret (after any selection), wherever the user
  // last left it — type "hello", speak "world", type "!" all compose — and never steals focus,
  // so it works with the keyboard closed. The editor's own onChange then feeds the draft, so
  // persistence sees dictation exactly like typing.
  const insert = useCallback(
    (text: string) => {
      fromVoice.current = true;
      // editor not loaded yet: keep the text in the draft rather than lose it
      if (!editor.current?.insertAtCaret(text)) setDraft((d) => (d ? `${d} ${text}` : text));
    },
    [setDraft],
  );

  const voice = useVoiceCapture(threadId, insert);
  const listening = voice.phase === "listening";
  const active = voice.phase !== "idle";
  const status = voiceStatus(voice) ?? (imageError ? { text: imageError, tone: "error" as const } : null);

  // The draft is only cleared once the text is stored (or answered). A failure
  // leaves it in the box — and in localStorage — exactly as typed.
  const submit = async () => {
    const text = (editor.current?.getMarkdown() ?? draft).trim();
    if (!text || busy || sending.current) return;
    sending.current = true; // ⌘↵ twice before `busy` renders must not send twice
    try {
      const ok =
        mode === "note" ? await onNote(text, fromVoice.current ? { voice: true } : null) : await onAsk(text, commit);
      if (ok) {
        // Speech can land while the send is in flight — remove only what was sent, keep the rest.
        const raw = (editor.current?.getMarkdown() ?? "").trim();
        const at = raw.indexOf(text);
        const rest = at < 0 ? raw : (raw.slice(0, at) + raw.slice(at + text.length)).trim();
        editor.current?.setMarkdown(rest);
        setDraft(rest);
        fromVoice.current = rest !== "";
      }
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="border-t border-border bg-card">
      {voice.recovery && (
        <div className="rise flex items-center justify-between gap-3 border-b border-primary bg-accent px-6 py-2 md:px-10">
          <span className="text-sm">
            Unfinished recording — {voice.recovery.lineCount} line{voice.recovery.lineCount === 1 ? "" : "s"} recovered
          </span>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={async () => {
                const text = await voice.recover();
                if (text) insert(text);
              }}
            >
              Recover
            </Button>
            <Button size="sm" variant="ghost" onClick={voice.dismissRecovery}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-10">
        <div className="relative">
          <MarkdownEditor
            handleRef={editor}
            value={draft}
            onChange={setDraft}
            readOnly={busy}
            onImageFile={(f) => attach([f])}
            placeholder={mode === "note" ? "Add to this thread…" : "Ask Claude about this thread…"}
            className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-max-height:45dvh] [--md-min-height:10rem] md:[--md-min-height:14rem] [--md-padding:12px_64px_12px_14px] [--md-img-max:12rem]"
            onKeyDownCapture={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                submit();
              }
            }}
          />
          <Button
            size="icon"
            variant={active ? "danger" : "ghost"}
            aria-label={active ? "Stop dictation" : "Dictate"}
            aria-pressed={active}
            className={cn("absolute right-2 top-2 gap-2 transition-[width]", listening && "w-[3.25rem]")}
            onClick={voice.toggle}
            // keep the caret where the user left it: don't let the tap blur/refocus the editor
            onPointerDown={(e) => e.preventDefault()}
          >
            {listening ? (
              <>
                <VoiceMeter />
                <Square className="size-3 fill-current" />
              </>
            ) : (
              <Mic className={cn("size-4", active && "blink")} />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Add photo"
            title="Add photo"
            className="absolute right-2 top-11"
            disabled={busy}
            onClick={() => picker.current?.click()}
            onPointerDown={(e) => e.preventDefault()}
          >
            <ImagePlus className="size-4" />
          </Button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="photo-input"
            onChange={(e) => {
              attach([...(e.target.files ?? [])]);
              e.target.value = ""; // picking the same photo again must fire again
            }}
          />
        </div>

        <div className="mt-1 h-4" aria-live="polite">
          {status && (
            <p
              className={cn(
                "truncate font-mono text-[11px]",
                status.tone === "error" && "text-destructive",
                status.tone === "ghost" && "italic text-foreground/70",
                status.tone === "quiet" && "text-muted-foreground",
              )}
            >
              {status.text}
            </p>
          )}
        </div>

        {showVoice && <VoiceSettings />}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <fieldset className="flex gap-px border border-border p-px">
            <legend className="sr-only">Entry type</legend>
            {MODES.map(({ value, label }) => (
              <label
                key={value}
                title={value === "ask" && !canAsk ? "Claude runs on the main backend — go live to ask." : undefined}
                className={cn(
                  "cursor-pointer px-3 py-1 text-xs font-medium transition-colors has-focus-visible:outline has-focus-visible:outline-ring",
                  value === "ask" && !canAsk && "cursor-not-allowed opacity-45",
                  mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  disabled={value === "ask" && !canAsk}
                  onChange={() => setMode(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </fieldset>

          {mode === "ask" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={commit}
                onChange={(e) => setCommit(e.target.checked)}
              />
              Keep exchange in thread
            </label>
          )}

          <Button
            className="ml-auto"
            size="icon"
            variant="ghost"
            aria-label="Voice settings"
            aria-expanded={showVoice}
            onClick={() => setShowVoice((v) => !v)}
          >
            <Settings2 className="size-4" />
          </Button>

          <Button disabled={busy || !draft.trim()} onClick={submit}>
            {busy ? "Working…" : mode === "note" ? "Add" : "Ask"}
            {!busy && <CornerDownLeft className="size-3.5 opacity-70" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

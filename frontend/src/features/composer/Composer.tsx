import { CornerDownLeft, Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageInput, type MessageInputHandle } from "@/features/message-input";
import { cn } from "@/lib/cn";
import type { VoiceState } from "@/lib/voice/engine";
import { useVoiceCapture } from "./useVoiceCapture";
import { VoiceMeter } from "./VoiceMeter";

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

// The capture line. Wraps MessageInput with what's composer-specific: voice dictation, the
// note/ask mode toggle and "keep exchange" checkbox. The parent only hears "add this" / "ask this".
export const Composer = ({
  threadId,
  busy,
  canAsk,
  onNote,
  onAsk,
}: {
  threadId: string;
  busy: boolean;
  canAsk: boolean; // Claude runs on the backend; in local mode the Ask toggle is not offered
  onNote: (text: string, meta: { voice: true } | null) => Promise<boolean>;
  onAsk: (prompt: string, commit: boolean) => Promise<boolean>;
}) => {
  const fromVoice = useRef(false); // a ref, not state: editing must not un-flag dictated text
  const [picked, setMode] = useState<Mode>("note");
  const mode = canAsk ? picked : "note";
  const [commit, setCommit] = useState(true);
  const input = useRef<MessageInputHandle>(null);

  // Finished dictation lands at the editor's caret (after any selection), wherever the user
  // last left it — type "hello", speak "world", type "!" all compose — and never steals focus,
  // so it works with the keyboard closed. MessageInput's own onChange then feeds the draft, so
  // persistence sees dictation exactly like typing.
  const insert = (text: string) => {
    fromVoice.current = true;
    input.current?.insertAtCaret(text);
  };

  const voice = useVoiceCapture(threadId, insert);
  const listening = voice.phase === "listening";
  const active = voice.phase !== "idle";
  const status = voiceStatus(voice);

  const onSubmit = (text: string) =>
    mode === "note" ? onNote(text, fromVoice.current ? { voice: true } : null) : onAsk(text, commit);

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
        <MessageInput
          handleRef={input}
          draftKey={threadId}
          busy={busy}
          placeholder={mode === "note" ? "Add to this thread…" : "Ask Claude about this thread…"}
          onSubmit={onSubmit}
          onSubmitted={(rest) => {
            fromVoice.current = rest !== "";
          }}
          statusOverride={status}
          overlay={
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
          }
          controls={
            <>
              {canAsk && (
                <fieldset className="flex gap-px border border-border p-px">
                  <legend className="sr-only">Entry type</legend>
                  {MODES.map(({ value, label }) => (
                    <label
                      key={value}
                      className={cn(
                        "cursor-pointer px-3 py-1 text-xs font-medium transition-colors has-focus-visible:outline has-focus-visible:outline-ring",
                        mode === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}

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
            </>
          }
          submitLabel={
            <>
              {busy ? "Working…" : mode === "note" ? "Add" : "Ask"}
              {!busy && <CornerDownLeft className="size-3.5 opacity-70" />}
            </>
          }
        />
      </div>
    </div>
  );
};

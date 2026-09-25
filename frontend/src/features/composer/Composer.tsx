import { Check, GitBranchPlus, Loader2, Mic, MoreHorizontal, Plus, RotateCcw, Send, Square, X } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { MessageInput, type MessageInputHandle } from "@/features/message-input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { pullThreads } from "@/lib/sync";
import type { Message } from "@/lib/types";
import type { VoiceState } from "@/lib/voice/engine";
import { useVoiceCapture } from "./useVoiceCapture";
import { VoiceMeter } from "./VoiceMeter";

type Mode = "note" | "ask";
const MODES: { value: Mode; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "ask", label: "Ask" },
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
// note/ask mode toggle and the "keep exchange" chip. The parent only hears "add this" / "ask this".
export const Composer = ({
  threadId,
  messages,
  busy,
  canAsk,
  onNote,
  onAsk,
  onCopied,
  autofocus,
  onNavigateReference,
}: {
  threadId: string;
  messages: Message[]; // to find the last message "Clone from here" copies up to
  busy: boolean;
  canAsk: boolean; // Claude runs on the backend; in local mode the Ask toggle is not offered
  onNote: (text: string, meta: { voice: true } | null) => Promise<boolean>;
  onAsk: (prompt: string, commit: boolean) => Promise<boolean>;
  onCopied: (newThreadId: string) => void; // open the copy once it exists
  /** Land straight in a focused composer (a `/capture` deep link into a fresh thread). */
  autofocus?: boolean;
  /** A completed reference (`lib/references.ts`) was clicked while composing — App.tsx's
   * `openThreadAt`, threaded through from ThreadView. */
  onNavigateReference: (threadId: string, messageId?: string) => void;
}) => {
  const fromVoice = useRef(false); // a ref, not state: editing must not un-flag dictated text
  const [picked, setMode] = useState<Mode>("note");
  const mode = canAsk ? picked : "note";
  const [commit, setCommit] = useState(true);
  const [copying, setCopying] = useState(false);
  const input = useRef<MessageInputHandle>(null);
  const reduceMotion = useReducedMotion();

  // Finished dictation lands at the editor's caret (after any selection), wherever the user
  // last left it — type "hello", speak "world", type "!" all compose — and never steals focus,
  // so it works with the keyboard closed. MessageInput's own onChange then feeds the draft, so
  // persistence sees dictation exactly like typing.
  const insert = (text: string) => {
    fromVoice.current = true;
    input.current?.insertAtCaret(text);
  };

  const voice = useVoiceCapture(threadId, insert);
  const active = voice.phase !== "idle";
  // The button only "records" (meter, stop square) once transcription can actually happen; until
  // then it spins, and the status line under the editor says what it's waiting for.
  const preparing = active && !voice.operational;
  const status = voiceStatus(voice);

  const onSubmit = (text: string) =>
    mode === "note" ? onNote(text, fromVoice.current ? { voice: true } : null) : onAsk(text, commit);

  const lastMessage = messages.at(-1);

  // Copies A up to the last message and appends whatever's typed as B's next note, in the one
  // call (a second request here could lose the text if it failed). The
  // draft is only cleared once the copy actually lands.
  const copyThreadFromHere = async () => {
    if (copying || !lastMessage) return;
    setCopying(true);
    try {
      const text = input.current?.getText() ?? "";
      const newThreadId = crypto.randomUUID();
      const { thread } = await api.copyThread(threadId, {
        newThreadId,
        uptoMessageId: lastMessage.id,
        appendNote: text ? { id: `note-${newThreadId}`, content: text } : undefined,
      });
      input.current?.clear();
      await pullThreads();
      onCopied(thread.id);
    } catch (e) {
      toast({ title: "Clone failed", description: errorMessage(e) }); // the draft is left untouched
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="surface-secondary border-t border-border">
      <AnimatePresence>
        {voice.recovery && (
          <m.div
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15, ease: "easeIn" } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mx-auto max-w-3xl px-3 pt-2 md:px-10 md:pt-3"
          >
            <div className="surface-sheen flex items-center gap-1 rounded-2xl border border-border py-1 pr-1 pl-4 shadow-sm">
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={`${voice.recovery.lineCount} line${voice.recovery.lineCount === 1 ? "" : "s"}`}
              >
                Recover recording?
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Recover recording"
                title="Recover"
                className="press-icon"
                onClick={async () => {
                  const text = await voice.recover();
                  if (text) insert(text);
                }}
              >
                <RotateCcw className="size-5 md:size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Discard recording"
                title="Discard"
                className="press-icon"
                onClick={voice.dismissRecovery}
              >
                <X className="size-5 md:size-4" />
              </Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <div className="composer-pad mx-auto max-w-3xl px-3 pt-2 md:px-10 md:pt-3">
        <MessageInput
          handleRef={input}
          draftKey={threadId}
          busy={busy}
          placeholder={mode === "note" ? "Note" : "Ask"}
          autofocus={autofocus}
          onReferenceClick={(threadId, messageId) => onNavigateReference(threadId, messageId ?? undefined)}
          onSubmit={onSubmit}
          onSubmitted={(rest) => {
            fromVoice.current = rest !== "";
          }}
          statusOverride={status}
          leadingActions={
            <Button
              size="icon"
              variant={active ? "danger" : "ghost"}
              aria-label={active ? "Stop dictation" : "Dictate"}
              aria-pressed={active}
              className={cn("press-icon gap-2 transition-[width]", voice.operational && "w-[3.25rem]")}
              onClick={() => {
                // Focus first, inside the tap: the editor is where the words will land (and stay
                // editable while you talk), and only a user gesture raises the iOS keyboard.
                if (!active) input.current?.focus();
                voice.toggle();
              }}
              // keep the caret where the user left it: don't let the tap blur/refocus the editor
              onPointerDown={(e) => e.preventDefault()}
            >
              {voice.operational ? (
                <>
                  <VoiceMeter />
                  <Square className="size-3 fill-current" />
                </>
              ) : preparing ? (
                <Loader2 className="size-5 animate-spin md:size-4" />
              ) : (
                <Mic className="size-5 md:size-4" />
              )}
            </Button>
          }
          controls={
            canAsk && (
              <>
                <fieldset className="inline-flex rounded-full border border-border bg-muted p-0.5">
                  <legend className="sr-only">Entry type</legend>
                  {MODES.map(({ value, label }) => (
                    <label
                      key={value}
                      className={cn(
                        "relative inline-flex h-8 min-w-14 cursor-pointer items-center justify-center rounded-full px-3 text-[13px] font-medium",
                        "transition-[background-color,color,box-shadow] duration-150 ease-out-strong has-focus-visible:ring-2 has-focus-visible:ring-ring",
                        "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
                        mode === value
                          ? "bg-card text-foreground shadow-sm"
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

                {mode === "ask" && (
                  <button
                    type="button"
                    aria-pressed={commit}
                    onClick={() => setCommit((c) => !c)}
                    className={cn(
                      "press relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium",
                      "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
                      commit
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {commit && <Check className="size-3.5" />}
                    Keep exchange
                  </button>
                )}
              </>
            )
          }
          submitAriaLabel={busy ? "Working…" : mode === "note" ? "Add note" : "Ask Claude"}
          submitLabel={
            busy ? (
              <Loader2 className="size-5 animate-spin md:size-4" />
            ) : mode === "note" ? (
              <Plus className="size-5 md:size-4" strokeWidth={2.25} />
            ) : (
              <Send className="size-5 md:size-4" />
            )
          }
          overflowActions={
            lastMessage && (
              <Menu
                align="end"
                items={[{ label: "Clone from here", icon: GitBranchPlus, onClick: copyThreadFromHere }]}
                trigger={
                  <button
                    type="button"
                    aria-label="More actions"
                    title="More actions"
                    disabled={copying}
                    className="press-icon flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:size-9"
                  >
                    <MoreHorizontal className="size-5 md:size-4" />
                  </button>
                }
              />
            )
          }
        />
      </div>
    </div>
  );
};

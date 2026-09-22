import { Copy, CornerDownLeft, Mic, MoreHorizontal, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { MessageInput, type MessageInputHandle } from "@/features/message-input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pullThreads } from "@/lib/sync";
import type { Message } from "@/lib/types";
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
  messages,
  busy,
  canAsk,
  onNote,
  onAsk,
  onCopied,
}: {
  threadId: string;
  messages: Message[]; // to find the last message "Copy thread from here" copies up to
  busy: boolean;
  canAsk: boolean; // Claude runs on the backend; in local mode the Ask toggle is not offered
  onNote: (text: string, meta: { voice: true } | null) => Promise<boolean>;
  onAsk: (prompt: string, commit: boolean) => Promise<boolean>;
  onCopied: (newThreadId: string) => void; // open the copy once it exists
}) => {
  const fromVoice = useRef(false); // a ref, not state: editing must not un-flag dictated text
  const [picked, setMode] = useState<Mode>("note");
  const mode = canAsk ? picked : "note";
  const [commit, setCommit] = useState(true);
  const [copying, setCopying] = useState(false);
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

  const lastMessage = messages.at(-1);

  // Copies A up to the last message and appends whatever's typed as B's next note, in the one
  // call (see AGENTS.md / backlog: a second request here could lose the text if it failed). The
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
    } catch {
      // ponytail: no status line for this yet — a failed copy just leaves the draft untouched
    } finally {
      setCopying(false);
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
          trailingActions={
            lastMessage && (
              <Menu
                align="end"
                items={[{ label: "Copy thread from here", icon: Copy, onClick: copyThreadFromHere }]}
                trigger={
                  <button
                    type="button"
                    aria-label="More actions"
                    title="More actions"
                    disabled={copying}
                    className="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring disabled:opacity-50"
                  >
                    <MoreHorizontal className="size-4" />
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

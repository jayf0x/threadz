import { CornerDownLeft, Mic, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useVoiceCapture } from "@/hooks/useVoiceCapture";
import { cn } from "@/lib/cn";

type Mode = "note" | "ask";
const MODES: { value: Mode; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "ask", label: "Ask Claude" },
];

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// The capture line. Owns the draft + voice; the parent only hears "add this" / "ask this".
export const Composer = ({
  threadId,
  busy,
  onNote,
  onAsk,
}: {
  threadId: string;
  busy: boolean;
  onNote: (text: string, meta: { voice: true } | null) => void;
  onAsk: (prompt: string, commit: boolean) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [mode, setMode] = useState<Mode>("note");
  const [commit, setCommit] = useState(true);
  const voice = useVoiceCapture();

  const live = voice.state === "recording" || voice.state === "transcribing";
  const loading = voice.state === "loading-model" || voice.state === "transcribing";

  const edit = (v: string) => {
    setDraft(v);
    setFromVoice(false);
  };
  const appendVoice = (text: string | null | undefined) => {
    if (!text) return;
    setDraft((d) => (d ? `${d} ${text}` : text));
    setFromVoice(true);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setFromVoice(false);
    if (mode === "note") return onNote(text, fromVoice ? { voice: true } : null);
    // A failed ask must not eat what was typed.
    if (!(await onAsk(text, commit))) setDraft((d) => d || text);
  };

  const onMic = async () => {
    if (live) appendVoice(await voice.stop());
    else voice.start(threadId);
  };

  return (
    <div className="border-t border-border bg-card">
      {voice.recovery && (
        <div className="rise flex items-center justify-between gap-3 border-b border-primary bg-accent px-6 py-2 md:px-10">
          <span className="text-sm">
            Unfinished recording — {voice.recovery.lineCount} line{voice.recovery.lineCount === 1 ? "" : "s"} recovered
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={async () => appendVoice(await voice.recoverText())}>
              Recover
            </Button>
            <Button size="sm" variant="ghost" onClick={voice.discardRecovery}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {live && (
        <div className="border-b border-border px-6 py-2.5 md:px-10">
          <div className="mx-auto max-w-3xl">
            <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-destructive">
              <span>
                <span className="blink">●</span> {voice.state === "transcribing" ? "finishing" : "recording"}
              </span>
              <span className="text-muted-foreground">
                {clock(voice.elapsedMs)} · {voice.segmentCount} line{voice.segmentCount === 1 ? "" : "s"}
              </span>
            </p>
            <p className="mt-1 max-h-20 overflow-y-auto font-serif text-[15px] leading-relaxed">
              {voice.tail.join(" ")} <span className="text-muted-foreground">{voice.partial}</span>
              {!voice.tail.length && !voice.partial && (
                <span className="text-muted-foreground">Listening — keep this screen on.</span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-10">
        <div className="relative">
          <Textarea
            aria-label={mode === "note" ? "New note" : "Question for Claude"}
            className="h-24 pr-12"
            placeholder={mode === "note" ? "Add to this thread…" : "Ask Claude about this thread…"}
            value={draft}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            size="icon"
            variant={live ? "danger" : "ghost"}
            disabled={loading && !live}
            aria-label={live ? "Stop recording" : "Record voice"}
            className="absolute right-2 top-2"
            onClick={onMic}
          >
            {live ? <Square className="size-3.5 fill-current" /> : <Mic className={cn("size-4", loading && "blink")} />}
          </Button>
        </div>

        {voice.state === "loading-model" && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">downloading speech model… {voice.progress}%</p>
        )}
        {voice.error && <p className="mt-1 font-mono text-[11px] text-destructive">{voice.error}</p>}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <fieldset className="flex gap-px border border-border p-px">
            <legend className="sr-only">Entry type</legend>
            {MODES.map(({ value, label }) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer px-3 py-1 text-xs font-medium transition-colors has-focus-visible:outline has-focus-visible:outline-ring",
                  mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-primary" checked={commit} onChange={(e) => setCommit(e.target.checked)} />
              Keep exchange in thread
            </label>
          )}

          <Button className="ml-auto" disabled={busy || !draft.trim()} onClick={submit}>
            {busy ? "Working…" : mode === "note" ? "Add" : "Ask"}
            {!busy && <CornerDownLeft className="size-3.5 opacity-70" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

import { format, isToday, isYesterday } from "date-fns";
import { ArrowLeft, Mic, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { Button } from "@/components/ui/button";
import { useThread } from "@/hooks/useThread";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getThreadLocal } from "@/lib/db";
import { useStatus } from "@/lib/status";
import { pullThreads } from "@/lib/sync";
import type { Thread } from "@/lib/types";

type Entry = {
  id: string;
  who: "user" | "assistant";
  content: string;
  at: number;
  voice: boolean;
  pending: boolean; // only this device has it so far
};

const dayLabel = (t: number) => {
  const d = format(t, "EEE d MMM yyyy");
  return isToday(t) ? `${d} · Today` : isYesterday(t) ? `${d} · Yesterday` : d;
};

export const ThreadView = ({
  threadId,
  onBack,
  onDeleted,
}: {
  threadId: string;
  onBack: () => void;
  onDeleted: () => void;
}) => {
  const { messages, unsynced, busy, error, addMessage, ask } = useThread(threadId);
  const local = useStatus().mode === "local";
  const [thread, setThread] = useState<Thread | null>(null);
  const [scratch, setScratch] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const onAsk = async (prompt: string, commit: boolean) => {
    setScratch(null);
    try {
      const answer = await ask(prompt, commit);
      if (!commit) setScratch(answer);
      return true;
    } catch {
      return false; // useThread already surfaced the error
    }
  };

  const del = async () => {
    const warn = local
      ? "Delete this thread? It leaves this device now and main on the next sync. A copy stays in your backups."
      : "Delete this thread? This cannot be undone.";
    if (!confirm(warn)) return;
    await api.deleteThread(threadId);
    await pullThreads().catch(() => {}); // drop it from the index
    onDeleted();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read thread meta after each message pull
  useEffect(() => {
    getThreadLocal(threadId).then((t) => setThread(t ?? null));
  }, [threadId, messages]);

  // A log reads top-down and you write at the bottom: follow the newest entry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the entry count changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, scratch]);

  const entries: Entry[] = [
    ...messages.map((m) => ({
      id: m.id,
      who: m.role,
      content: m.content,
      at: m.createdAt,
      voice: !!m.meta?.voice,
      pending: unsynced.has(m.id),
    })),
  ];

  const days: { label: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.at);
    if (days.at(-1)?.label === label) days.at(-1)?.items.push(e);
    else days.push({ label, items: [e] });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 pb-4 pt-5 md:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="-ml-2 flex items-center justify-between">
            <Button size="sm" variant="ghost" className="lg:invisible" onClick={onBack}>
              <ArrowLeft className="size-3.5" /> Index
            </Button>
            <Button size="sm" variant="danger" onClick={del}>
              Delete
            </Button>
          </div>
          <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight md:text-4xl">{thread?.title ?? "…"}</h1>
          {thread?.description && (
            <p className="mt-2 max-w-prose font-serif text-base italic text-muted-foreground">{thread.description}</p>
          )}
          {thread && (
            <p className="mt-3 flex flex-wrap gap-x-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <span>{format(thread.createdAt, "d MMM yyyy")}</span>
              <span>
                {messages.length} entr{messages.length === 1 ? "y" : "ies"}
              </span>
              {local && <span className="text-primary">Local copy</span>}
              {thread.tags.map((t) => (
                <span key={t} className="normal-case tracking-normal">
                  #{t}
                </span>
              ))}
            </p>
          )}
        </div>
      </header>

      {error && (
        <p className="border-b border-destructive px-6 py-2 font-mono text-[11px] text-destructive md:px-10">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 md:px-10">
        <div className="mx-auto max-w-3xl pb-6">
          {days.length === 0 && !scratch && (
            <p className="py-16 font-serif text-lg italic text-muted-foreground">
              Blank page. Write the first line below.
            </p>
          )}

          {days.map((day) => (
            <section key={day.label}>
              <h2 className="sticky top-0 z-10 border-b border-rule bg-background py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {day.label}
              </h2>
              <div className="pt-5">
                {day.items.map((e, i) => (
                  <EntryRow key={e.id} entry={e} index={i} />
                ))}
              </div>
            </section>
          ))}

          {scratch && (
            <div className="rise hatch relative mt-2 border border-dashed border-primary p-4">
              <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-primary">
                Scratch — not saved
                <button type="button" aria-label="Dismiss scratch answer" onClick={() => setScratch(null)}>
                  <X className="size-3.5" />
                </button>
              </p>
              <p className="mt-2 whitespace-pre-wrap font-serif text-base leading-relaxed">{scratch}</p>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      <Composer threadId={threadId} busy={busy} canAsk={!local} onNote={addMessage} onAsk={onAsk} />
    </div>
  );
};

// One line of the log: time in the margin, a dot on the rule, the text.
// Your notes are plain; Claude's are set in serif with a filled dot.
const EntryRow = ({ entry: e, index }: { entry: Entry; index: number }) => {
  const claude = e.who === "assistant";
  return (
    <article className="rise grid grid-cols-[3rem_1fr] gap-x-4" style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <time className="pt-0.5 text-right font-mono text-[11px] text-muted-foreground">{format(e.at, "HH:mm")}</time>
      <div className={cn("relative border-l pb-6 pl-5", e.pending ? "hatch border-dashed" : "border-rule")}>
        <span
          className={cn(
            "absolute -left-[5px] top-2 size-2 rounded-full border",
            claude ? "border-primary bg-primary" : "border-muted-foreground bg-background",
          )}
        />
        {(claude || e.voice || e.pending) && (
          <p className="mb-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {claude && <span className="text-primary">Claude</span>}
            {e.voice && (
              <span className="flex items-center gap-1">
                <Mic className="size-2.5" /> voice
              </span>
            )}
            {e.pending && <span>on device</span>}
          </p>
        )}
        <p className={cn("whitespace-pre-wrap", claude ? "font-serif text-base leading-relaxed" : "text-[15px]")}>
          {e.content}
        </p>
      </div>
    </article>
  );
};

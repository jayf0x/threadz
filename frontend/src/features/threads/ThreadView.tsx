import { format } from "date-fns";
import { ArrowLeft, CloudOff, Copy, Mic, MoreHorizontal, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Composer } from "@/features/composer";
import { ImageButton, MarkdownEditor, type MarkdownEditorHandle, useImageAttach } from "@/features/editor";
import { api } from "@/lib/api";
import { getThreadLocal } from "@/lib/db";
import { useStatus } from "@/lib/status";
import { onChange, pullThreads } from "@/lib/sync";
import type { Message, Thread } from "@/lib/types";
import { useThread } from "./useThread";

export const ThreadView = ({
  threadId,
  onBack,
  onCopied,
}: {
  threadId: string;
  onBack: () => void;
  onCopied: (newThreadId: string) => void; // open the copy once it exists
}) => {
  const { messages, unsynced, busy, error, gone, addMessage, editMessage, ask } = useThread(threadId);
  const local = useStatus().mode === "local";
  const [thread, setThread] = useState<Thread | null>(null);
  const [vanished, setVanished] = useState(false); // was in the mirror, then a list refresh dropped it
  const [scratch, setScratch] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // An empty mirror means "still loading", not "deleted": only the store's own 404 (`gone`), or a thread
  // we had displayed disappearing from a refreshed mirror, says the thread is really gone.
  const missing = gone || vanished;

  // "Copy thread from here": B is A up to and including this message. A is never touched.
  const copyThreadFrom = async (uptoMessageId: string) => {
    if (copying) return;
    setCopying(true);
    try {
      const { thread: copy } = await api.copyThread(threadId, { newThreadId: crypto.randomUUID(), uptoMessageId });
      await pullThreads();
      onCopied(copy.id);
    } catch {
      // ponytail: no status line for this yet — a failed copy just does nothing, nothing was touched
    } finally {
      setCopying(false);
    }
  };

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

  // The title can change from the sidebar (rename) or from a pull.
  useEffect(() => {
    let seen = false;
    const load = () =>
      getThreadLocal(threadId).then((t) => {
        seen ||= !!t;
        setThread(t ?? null);
        setVanished(seen && !t);
      });
    load();
    return onChange(load);
  }, [threadId]);

  // A log reads top-down and you write at the bottom: follow the newest entry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the entry count changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, scratch]);

  if (missing) return <NotFound onBack={onBack} />;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-3 md:px-10">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Button size="sm" variant="ghost" className="-ml-2 lg:hidden" onClick={onBack}>
            <ArrowLeft className="size-3.5" /> Index
          </Button>
          <h1 className="min-w-0 truncate font-serif text-2xl leading-tight tracking-tight">{thread?.title ?? "…"}</h1>
        </div>
      </header>

      {error && (
        <p className="border-b border-destructive px-6 py-2 font-mono text-[11px] text-destructive md:px-10">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 md:px-10">
        <div className="mx-auto max-w-3xl pb-6">
          {messages.length === 0 && !scratch && (
            <p className="py-16 font-serif text-lg italic text-muted-foreground">
              Blank page. Write the first line below.
            </p>
          )}

          {messages.map((m) => (
            <EntryRow
              key={m.id}
              message={m}
              pending={unsynced.has(m.id)}
              busy={busy}
              onEdit={(text) => editMessage(m.id, text)}
              onCopyThread={() => copyThreadFrom(m.id)}
            />
          ))}

          {scratch && (
            <div className="mt-4 border border-dashed border-border p-4">
              <Eyebrow className="flex items-center justify-between">
                Scratch — not saved
                <button type="button" aria-label="Dismiss scratch answer" onClick={() => setScratch(null)}>
                  <X className="size-3.5" />
                </button>
              </Eyebrow>
              <MarkdownEditor readOnly value={scratch} className="[--md-padding:0.5rem_0_0]" />
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      <Composer
        threadId={threadId}
        messages={messages}
        busy={busy}
        canAsk={!local}
        onNote={addMessage}
        onAsk={onAsk}
        onCopied={onCopied}
      />
    </div>
  );
};

const NotFound = ({ onBack }: { onBack: () => void }) => (
  <div className="h-full px-6 py-16 md:px-10">
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl leading-tight tracking-tight">Thread not found</h1>
      <p className="mt-2 font-serif text-lg italic text-muted-foreground">
        It was deleted on another device, or isn't in this copy yet.
      </p>
      <Button size="sm" variant="ghost" className="-ml-2 mt-4" onClick={onBack}>
        <ArrowLeft className="size-3.5" /> Back to the index
      </Button>
    </div>
  </div>
);

const tiny = "font-mono text-[10px] text-muted-foreground";

// One entry: the content, then a hairline of tiny metadata under it. Your notes can be
// edited in place (the previous text is kept and can be shown under "edited").
// ponytail: every entry is its own read-only editor instance; virtualize if a thread reaches hundreds.
const EntryRow = ({
  message: m,
  pending,
  busy,
  onEdit,
  onCopyThread,
}: {
  message: Message;
  pending: boolean;
  busy: boolean;
  onEdit: (text: string) => Promise<boolean>;
  onCopyThread: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [history, setHistory] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const { attach, error: imageError } = useImageAttach(editor);
  const mine = m.role === "user";
  const changed = text.trim() && text.trim() !== m.content;

  const save = async () => {
    const next = (editor.current?.getMarkdown() ?? text).trim(); // `text` lags typing by the debounce
    if (next && next !== m.content && (await onEdit(next))) setEditing(false);
  };
  const startEdit = () => {
    setText(m.content);
    setEditing(true);
  };
  // Extend this array (not the JSX) for "Annotate" as it lands.
  const menuItems: MenuItem[] = [
    { label: "Edit", icon: Pencil, onClick: startEdit },
    { label: "Copy thread from here", icon: Copy, onClick: onCopyThread },
  ];

  return (
    <article className="group border-b border-rule py-4">
      {!mine && <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-primary">Claude</p>}

      {editing ? (
        <>
          <div className="relative">
            <MarkdownEditor
              handleRef={editor}
              value={text}
              onChange={setText}
              readOnly={busy}
              onImageFile={(f) => attach([f])}
              className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-max-height:60dvh] [--md-min-height:8rem] [--md-padding:10px_44px_10px_12px]"
              onKeyDownCapture={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  save();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
            <ImageButton onFiles={attach} disabled={busy} className="absolute right-1 top-1" />
          </div>
          {imageError && <p className="mt-1 truncate font-mono text-[11px] text-destructive">{imageError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !changed} onClick={save}>
              Save
            </Button>
          </div>
        </>
      ) : (
        <MarkdownEditor readOnly value={m.content} className="[--md-padding:0]" />
      )}

      {!editing && (
        <p className={`mt-1.5 flex items-center gap-2 ${tiny}`}>
          <time>{format(m.createdAt, "d MMM HH:mm")}</time>
          {!!m.meta?.voice && <Mic className="size-2.5" aria-label="voice" />}
          {pending && <CloudOff className="size-2.5" aria-label="only on this device so far" />}
          {!!m.edits?.length && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setHistory((h) => !h)}>
              edited
            </button>
          )}
          {mine && (
            <Menu
              align="end"
              items={menuItems}
              trigger={
                <button
                  type="button"
                  aria-label="Message actions"
                  title="Message actions"
                  className="ml-auto p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <MoreHorizontal className="size-3" />
                </button>
              }
            />
          )}
        </p>
      )}

      {history &&
        !editing &&
        [...(m.edits ?? [])].reverse().map((v) => (
          <div key={v.at} className="mt-2 border-l-2 border-border pl-3 opacity-70">
            <p className={tiny}>{format(v.at, "d MMM HH:mm")}</p>
            <MarkdownEditor readOnly value={v.content} className="[--md-padding:0]" />
          </div>
        ))}
    </article>
  );
};

import { format } from "date-fns";
import { ArrowLeft, Check, CloudOff, Copy, Mic, MoreHorizontal, Pencil, StickyNote, Trash2, X } from "lucide-react";
import { AnimatePresence, m as Motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Menu } from "@/components/ui/menu";
import { Composer } from "@/features/composer";
import { ImageButton, MarkdownEditor, type MarkdownEditorHandle, useImageAttach } from "@/features/editor";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getThreadLocal } from "@/lib/db";
import { useStatus } from "@/lib/status";
import { onChange, pullThreads } from "@/lib/sync";
import type { Annotation, Message, Thread } from "@/lib/types";
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
  const {
    messages,
    annotations,
    unsynced,
    unsyncedAnnotations,
    busy,
    error,
    gone,
    justAdded,
    addMessage,
    editMessage,
    addAnnotation,
    editAnnotation,
    deleteAnnotation,
    ask,
  } = useThread(threadId);
  const local = useStatus().mode === "local";
  const [thread, setThread] = useState<Thread | null>(null);
  const [vanished, setVanished] = useState(false); // was in the mirror, then a list refresh dropped it
  const [scratch, setScratch] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // An empty mirror means "still loading", not "deleted": only the store's own 404 (`gone`), or a thread
  // we had displayed disappearing from a refreshed mirror, says the thread is really gone.
  const missing = gone || vanished;

  // One note per message (DB-enforced), so this is a plain lookup, not a grouped list.
  const noteByMessage = useMemo(() => new Map(annotations.map((a) => [a.messageId, a])), [annotations]);

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
              isNew={justAdded.has(m.id)}
              onEdit={(text) => editMessage(m.id, text)}
              onCopyThread={() => copyThreadFrom(m.id)}
              note={noteByMessage.get(m.id)}
              unsyncedAnnotations={unsyncedAnnotations}
              onAddAnnotation={(text) => addAnnotation(m.id, text)}
              onEditAnnotation={editAnnotation}
              onDeleteAnnotation={deleteAnnotation}
            />
          ))}

          <AnimatePresence>
            {scratch && (
              <Motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mt-4 border border-dashed border-border p-4"
              >
                <Eyebrow className="flex items-center justify-between">
                  Scratch — not saved
                  <button type="button" aria-label="Dismiss scratch answer" onClick={() => setScratch(null)}>
                    <X className="size-3.5" />
                  </button>
                </Eyebrow>
                <MarkdownEditor readOnly value={scratch} className="[--md-padding:0.5rem_0_0]" />
              </Motion.div>
            )}
          </AnimatePresence>
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
// A note (annotation) is a quiet aside attached to the entry, not another entry: collapsed to a
// small icon by default, expands in place (see the `noteOpen` panel below).
// ponytail: every entry is its own read-only editor instance; virtualize if a thread reaches hundreds.
const EntryRow = ({
  message: m,
  pending,
  busy,
  isNew,
  onEdit,
  onCopyThread,
  note,
  unsyncedAnnotations,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
}: {
  message: Message;
  pending: boolean;
  busy: boolean;
  isNew: boolean; // appended (or synced in) during this session — vs. part of the history load
  onEdit: (text: string) => Promise<boolean>;
  onCopyThread: () => void;
  note: Annotation | undefined; // one per message, DB-enforced
  unsyncedAnnotations: Set<string>;
  onAddAnnotation: (text: string) => Promise<boolean>;
  onEditAnnotation: (id: string, text: string) => Promise<boolean>;
  onDeleteAnnotation: (id: string) => Promise<boolean>;
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [history, setHistory] = useState(false);
  // Collapsed by default. `noteMounted` is one-way (set once opened, never back to false): the
  // panel then only ever *animates* closed instead of unmounting, which is what makes the collapse
  // transition smooth instead of the content just vanishing mid-shrink.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteMounted, setNoteMounted] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false); // editing existing note text, vs. its read view
  const [noteText, setNoteText] = useState(note?.content ?? "");
  const editor = useRef<MarkdownEditorHandle>(null);
  const noteEditor = useRef<MarkdownEditorHandle>(null);
  const reduceMotion = useReducedMotion();
  const { attach, error: imageError } = useImageAttach(editor);
  const { attach: noteAttach, error: noteImageError } = useImageAttach(noteEditor);
  const mine = m.role === "user";
  const changed = text.trim() && text.trim() !== m.content;
  const composingNote = noteEditing || !note; // nothing to view yet, or editing what's there
  const noteSaveDisabled = busy || !noteText.trim() || (!!note && noteText.trim() === note.content);

  const save = async () => {
    const next = (editor.current?.getMarkdown() ?? text).trim(); // `text` lags typing by the debounce
    if (next && next !== m.content && (await onEdit(next))) setEditing(false);
  };
  const startEdit = () => {
    setText(m.content);
    setEditing(true);
  };

  // Collapsed ⇄ expanded. Reopening (or closing) an existing note always lands on its quiet read
  // view, not wherever editing was left — composing a brand-new note keeps whatever was typed.
  const toggleNote = () => {
    setNoteMounted(true);
    setNoteOpen((open) => !open);
    if (note) setNoteEditing(false);
  };
  const startNoteEdit = () => {
    if (!note) return;
    setNoteText(note.content);
    setNoteEditing(true);
  };
  const cancelNoteEdit = () => {
    setNoteText(note?.content ?? "");
    if (note) setNoteEditing(false);
    else setNoteOpen(false); // nothing to fall back to — just collapse
  };
  const saveNote = async () => {
    const next = (noteEditor.current?.getMarkdown() ?? noteText).trim();
    if (!next) return;
    if (note) {
      if (next !== note.content && (await onEditAnnotation(note.id, next))) setNoteEditing(false);
    } else if (await onAddAnnotation(next)) {
      setNoteText("");
    }
  };
  const deleteNote = async () => {
    if (!note || !confirm("Delete this note? This cannot be undone.")) return;
    if (await onDeleteAnnotation(note.id)) {
      setNoteOpen(false);
      setNoteText(""); // otherwise reopening (now with no note) would pre-fill the just-deleted text
    }
  };

  return (
    <Motion.article
      className="group border-b border-rule py-4"
      // `initial={false}` starts a history-loaded row already in its resting state — only a
      // message that showed up after the fact (a note you just added, one that synced in) gets
      // the little rise-in; a long thread's first render never animates.
      initial={isNew && !reduceMotion ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {!mine && <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-primary">Claude</p>}

      {editing ? (
        <>
          <div className="relative">
            <MarkdownEditor
              raw
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
            <button
              type="button"
              aria-label={note ? "Note" : "Add a note"}
              title={note ? "Note" : "Add a note"}
              aria-expanded={noteOpen}
              onClick={toggleNote}
              className={cn(
                "ml-auto p-1 transition-colors",
                note
                  ? "text-primary/70 hover:text-primary"
                  : "text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <StickyNote className="size-3" />
            </button>
          )}
          {mine && (
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Message actions"
                  title="Message actions"
                  className="p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <MoreHorizontal className="size-3" />
                </button>
              }
              items={[
                { label: "Edit", icon: Pencil, onClick: startEdit },
                { label: "Copy thread from here", icon: Copy, onClick: onCopyThread },
              ]}
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

      {/* The note panel: a CSS grid row animated between 0fr/1fr (not height:auto — that can't
          transition) so it opens and closes with a smooth height+opacity glide, never a jump. */}
      {mine && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
            noteOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            {noteMounted && (
              <div className="mt-2 border-l-2 border-primary/40 py-0.5 pl-3">
                {composingNote ? (
                  <>
                    <div className="relative">
                      <MarkdownEditor
                        raw
                        handleRef={noteEditor}
                        value={noteText}
                        onChange={setNoteText}
                        readOnly={busy}
                        placeholder="A quick note…"
                        onImageFile={(f) => noteAttach([f])}
                        className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-min-height:3rem] [--md-max-height:12rem] [--md-padding:8px_38px_8px_10px]"
                        onKeyDownCapture={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            e.stopPropagation();
                            saveNote();
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            cancelNoteEdit();
                          }
                        }}
                      />
                      <ImageButton onFiles={noteAttach} disabled={busy} className="absolute right-1 top-1" />
                    </div>
                    {noteImageError && (
                      <p className="mt-1 truncate font-mono text-[11px] text-destructive">{noteImageError}</p>
                    )}
                    <div className="mt-1.5 flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label="Cancel"
                        title="Cancel"
                        onClick={cancelNoteEdit}
                        className="p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Save note"
                        title="Save note"
                        disabled={noteSaveDisabled}
                        onClick={saveNote}
                        className="p-1 text-primary hover:text-primary/80 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Check className="size-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  note && (
                    <>
                      <div className="flex items-start gap-2">
                        <MarkdownEditor readOnly value={note.content} className="min-w-0 flex-1 [--md-padding:0]" />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label="Edit note"
                            title="Edit note"
                            onClick={startNoteEdit}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete note"
                            title="Delete note"
                            onClick={deleteNote}
                            className="p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                      <p className={cn(tiny, "mt-1 flex items-center gap-2")}>
                        <time>{format(note.createdAt, "d MMM HH:mm")}</time>
                        {unsyncedAnnotations.has(note.id) && (
                          <CloudOff className="size-2.5" aria-label="only on this device so far" />
                        )}
                        {!!note.edits?.length && <span>edited</span>}
                      </p>
                    </>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Motion.article>
  );
};

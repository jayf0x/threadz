import * as Popover from "@radix-ui/react-popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { ArrowLeft, Check, CloudOff, Copy, Mic, MoreHorizontal, Pencil, StickyNote, Trash2, X } from "lucide-react";
import { AnimatePresence, m as Motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
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
  autofocus,
  scrollToMessageId,
}: {
  threadId: string;
  onBack: () => void;
  onCopied: (newThreadId: string) => void; // open the copy once it exists
  /** Land straight in a focused composer (a `/capture` deep link into a fresh thread). */
  autofocus?: boolean;
  /** A todo jump or `?thread=&msg=` deep link: scroll to this message once loaded, then flash it. */
  scrollToMessageId?: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrolledTo = useRef<string | undefined>(undefined); // don't re-jump once this target's been reached
  // An empty mirror means "still loading", not "deleted": only the store's own 404 (`gone`), or a thread
  // we had displayed disappearing from a refreshed mirror, says the thread is really gone.
  const missing = gone || vanished;

  // Windowed rendering: a long-lived thread can reach hundreds of entries, each its own
  // MarkdownEditor (a lazy Milkdown/ProseMirror mount) — cheap to scroll past, not cheap to all
  // exist at once. `estimateSize` is a rough starting guess (most entries are a line or two);
  // `measureElement` (wired on each row below) corrects it against the real rendered height as
  // rows come into view, including a later resize (opening edit mode, an image loading in).
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

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

  // A log reads top-down and you write at the bottom: follow the newest entry — unless a jump to a
  // specific message (below) is pending, which wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the entry count changes
  useEffect(() => {
    if (scrollToMessageId) return;
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, scratch, scrollToMessageId]);

  // Jump to a specific message (a todo row's click, or a `?thread=&msg=` deep link): scroll the
  // virtualizer to its index once it's actually in `messages` — a fresh mount's history load can
  // resolve after this prop is already set, so this keeps re-checking on every `messages` update
  // instead of scrolling once to an index that isn't there yet. `scrolledTo` guards against
  // re-jumping (and re-flashing) on every later message list update once the target's been hit.
  useEffect(() => {
    if (!scrollToMessageId || scrolledTo.current === scrollToMessageId) return;
    const index = messages.findIndex((m) => m.id === scrollToMessageId);
    if (index === -1) return;
    scrolledTo.current = scrollToMessageId;
    rowVirtualizer.scrollToIndex(index, { align: "center" });
    setHighlightId(scrollToMessageId);
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(t);
  }, [scrollToMessageId, messages, rowVirtualizer]);

  if (missing) return <NotFound onBack={onBack} />;

  return (
    <div className="flex h-full flex-col">
      {/* A breadcrumb on a phone (back arrow + small title, one compact row) — the sidebar is
          hidden while a thread is open there, so this is the only way back, not a place for a
          full editorial heading. `lg:` gets the roomier one back: the sidebar is already visible
          beside it, so the title can afford to be a real heading. */}
      <header className="border-b border-border px-3 py-2 md:px-10 lg:py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-1 lg:gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to index"
            className="shrink-0 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="min-w-0 truncate text-sm font-medium lg:font-serif lg:text-2xl lg:font-normal lg:leading-tight lg:tracking-tight">
            {thread?.title ?? "…"}
          </h1>
        </div>
      </header>

      {error && (
        <p className="border-b border-destructive px-6 py-2 font-mono text-[11px] text-destructive md:px-10">{error}</p>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 md:px-10">
        <div className="mx-auto max-w-3xl pb-6">
          {messages.length === 0 && !scratch && (
            <p className="py-16 font-serif text-lg italic text-muted-foreground">
              Blank page. Write the first line below.
            </p>
          )}

          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((row) => {
              const m = messages[row.index];
              if (!m) return null;
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <EntryRow
                    message={m}
                    pending={unsynced.has(m.id)}
                    busy={busy}
                    isNew={justAdded.has(m.id)}
                    highlighted={highlightId === m.id}
                    onEdit={(text) => editMessage(m.id, text)}
                    onCopyThread={() => copyThreadFrom(m.id)}
                    note={noteByMessage.get(m.id)}
                    unsyncedAnnotations={unsyncedAnnotations}
                    onAddAnnotation={(text) => addAnnotation(m.id, text)}
                    onEditAnnotation={editAnnotation}
                    onDeleteAnnotation={deleteAnnotation}
                  />
                </div>
              );
            })}
          </div>

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
        autofocus={autofocus}
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

// Edit box starts close to the size of the text it's replacing, not a fixed one-size box that's
// too cramped for a long note and too roomy for a one-liner — floor so a short message still gets
// a comfortable box, ceiling matching the editor's own `60dvh` scroll cap so a giant message
// doesn't measure into an edit box taller than the thread pane itself.
const EDIT_MIN_PX = 96;
const EDIT_MAX_RATIO = 0.6;

// One entry: the content, then a hairline of tiny metadata under it. Your notes can be
// edited in place (the previous text is kept and can be shown under "edited").
// A note (annotation) is a quiet aside attached to the entry, not another entry: a small icon,
// dim until there's one to show, opens it in a popover instead of pushing the thread's own
// layout around — reading down a long thread never loses its place to an expanding neighbour.
// ponytail: every entry is its own read-only editor instance; virtualize if a thread reaches hundreds.
const EntryRow = ({
  message: m,
  pending,
  busy,
  isNew,
  highlighted,
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
  highlighted: boolean; // landed on via a todo jump or `?thread=&msg=` link — flash it
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
  const [editMinHeight, setEditMinHeight] = useState(EDIT_MIN_PX);
  const [history, setHistory] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
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
    const measured = contentRef.current?.getBoundingClientRect().height ?? 0;
    setEditMinHeight(Math.min(Math.max(measured, EDIT_MIN_PX), window.innerHeight * EDIT_MAX_RATIO));
    setEditing(true);
  };

  // Reopening (or closing) an existing note always lands on its quiet read view, not wherever
  // editing was left — composing a brand-new note keeps whatever was typed.
  const onNoteOpenChange = (open: boolean) => {
    setNoteOpen(open);
    if (open && note) setNoteEditing(false);
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
      className={cn("group border-b border-rule py-4", highlighted && "message-highlight")}
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
              autofocus
              onImageFile={(f) => attach([f])}
              className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring [--md-max-height:60dvh] [--md-padding:10px_44px_10px_12px]"
              style={{ "--md-min-height": `${editMinHeight}px` } as CSSProperties}
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
        <div ref={contentRef}>
          <MarkdownEditor readOnly value={m.content} onTodoToggle={onEdit} className="[--md-padding:0]" />
        </div>
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
            <Popover.Root open={noteOpen} onOpenChange={onNoteOpenChange}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label={note ? "Note" : "Add a note"}
                  title={note ? "Note" : "Add a note"}
                  className={cn(
                    "ml-auto p-1 transition-colors",
                    note
                      ? "text-primary/70 hover:text-primary"
                      : "text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
                  )}
                >
                  <StickyNote className="size-3" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  collisionPadding={8}
                  className="z-50 w-80 max-w-[min(20rem,var(--radix-popover-content-available-width))] rounded-md border border-border bg-card p-3 shadow-lg outline-none"
                >
                  {composingNote ? (
                    <>
                      <div className="relative">
                        <MarkdownEditor
                          raw
                          handleRef={noteEditor}
                          value={noteText}
                          onChange={setNoteText}
                          readOnly={busy}
                          autofocus
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
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
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
    </Motion.article>
  );
};

import { format } from "date-fns";
import {
  Check,
  CloudOff,
  Copy,
  GitBranchPlus,
  Link,
  Mic,
  MoreHorizontal,
  Pencil,
  Square,
  SquareCheck,
  StickyNote,
  X,
} from "lucide-react";
import { m as Motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { ResponsiveOverlay } from "@/components/ui/responsive-overlay";
import { toast } from "@/components/ui/toast";
import {
  ContentField,
  ImageButton,
  MarkdownEditor,
  type MarkdownEditorHandle,
  useImageAttach,
} from "@/features/editor";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { buildReferenceHref, messageSnippet } from "@/lib/references";
import { toggleTodoLine } from "@/lib/todos";
import type { Annotation, Message } from "@/lib/types";
import { NoteSurface } from "./NoteSurface";
import { ROW_SELECT_IGNORE, shouldSelectRow } from "./rowSelect";

// One entry: the content, and — only while it is the selected message — one actions row under it (date and
// sync/voice/edited on the left, Edit / Add note / Todo / ⋯ on the right, all 44px targets). Your messages
// are edited in place: the read view and the editor are the same mounted `ContentField`, toggled
// `readOnly`, so nothing moves and the phone keyboard rises from the Edit tap itself. A note is a quiet
// aside — a chip under the message (present only once there is a note) that opens it in an overlay (sheet
// on a phone, popover from md), so reading down a long thread never loses its place to an expanding neighbour.
export const EntryRow = ({
  message: m,
  pending,
  busy,
  isNew,
  selected,
  pulsing,
  onSelect,
  onEdit,
  onCopyThread,
  onSetTodo,
  note,
  unsyncedAnnotations,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onNavigateReference,
}: {
  message: Message;
  pending: boolean;
  busy: boolean;
  isNew: boolean; // appended (or synced in) during this session — vs. part of the history load
  selected: boolean; // this thread's persistently-selected message (`?msg=`) — until deselected, not a flash
  pulsing: boolean; // landed on via a todo jump or `?thread=&msg=` link *this render* — brief arrival pulse on top of `selected`
  onSelect: () => void; // row clicked: select it, or clear if it's already selected (toggle lives in the caller)
  onEdit: (text: string) => Promise<boolean>;
  onCopyThread: () => void;
  onSetTodo: (done: boolean | null) => void; // the Todo toggle; null clears the flag
  note: Annotation | undefined; // one per message, DB-enforced
  unsyncedAnnotations: Set<string>;
  onAddAnnotation: (text: string) => Promise<boolean>;
  onEditAnnotation: (id: string, text: string) => Promise<boolean>;
  onDeleteAnnotation: (id: string) => Promise<boolean>;
  onNavigateReference: (threadId: string, messageId?: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const editor = useRef<MarkdownEditorHandle>(null);
  const row = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { attach, error: imageError } = useImageAttach(editor);
  const mine = m.role === "user";
  const todo = !!m.meta?.todo;
  const navigateReference = (threadId: string, messageId: string | null) =>
    onNavigateReference(threadId, messageId ?? undefined);

  // Ready to paste straight into another note — same `[text](thread=…?message=…)` shape the
  // autocomplete itself produces (lib/references.ts), not a bare URL.
  const copyLink = () =>
    copy(`[${messageSnippet(m.content) || "message"}](${buildReferenceHref(m.threadId, m.id)})`, "Link copied");
  const copyText = () => copy(m.content, "Copied");

  // `enterEdit` runs inside the tap on purpose: iOS raises the keyboard only for a focus() in the gesture.
  const startEdit = () => {
    editor.current?.enterEdit();
    setHistory(false);
    setEditing(true);
  };
  const cancelEdit = () => {
    editor.current?.exitEdit(true);
    setEditing(false);
  };
  // An untouched message never saves: Milkdown re-serialises, so the stored text is no baseline (see
  // features/editor/dirty.ts) — `isDirty()` compares against the editor's own snapshot from when editing began.
  const save = async () => {
    const field = editor.current;
    if (!field?.isDirty()) return;
    const next = field.getMarkdown().trim();
    if (next && (await onEdit(next))) {
      field.exitEdit();
      setEditing(false);
    }
  };

  const noteAnchor = note ? (
    <button
      type="button"
      title="Note"
      {...{ [ROW_SELECT_IGNORE]: "" }}
      className="flex h-11 max-w-full items-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
    >
      <span className="press-row inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] text-foreground">
        <StickyNote className="size-4 shrink-0" />
        <span className="truncate">{messageSnippet(note.content) || "Note"}</span>
        {unsyncedAnnotations.has(note.id) && <CloudOff className="size-3.5 shrink-0 text-muted-foreground" />}
      </span>
    </button>
  ) : (
    <Button size="icon" variant="ghost" aria-label="Add note" title="Add note">
      <StickyNote className="size-5 md:size-4" />
    </Button>
  );

  // On md+ the popover opens past the whole row (right-aligned, under the actions), not on top of them.
  const overlay = {
    open: noteOpen,
    onOpenChange: setNoteOpen,
    anchor: noteAnchor,
    title: "Note",
    virtualAnchor: row,
    align: "end" as const,
  };

  const noteBody = noteOpen && (
    <NoteSurface
      note={note}
      unsynced={!!note && unsyncedAnnotations.has(note.id)}
      busy={busy}
      draft={noteDraft}
      onDraftChange={setNoteDraft}
      onAdd={onAddAnnotation}
      onEdit={onEditAnnotation}
      onDelete={onDeleteAnnotation}
      onClose={() => setNoteOpen(false)}
      onNavigateReference={navigateReference}
    />
  );

  return (
    <Motion.article
      ref={row}
      className={cn(
        "group relative -mx-3 rounded-2xl px-3 py-3.5 [overflow-wrap:anywhere]",
        // The hairline is its own element (a border would curve with the rounded wash) and goes while selected.
        "after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-rule",
        selected || editing ? "after:opacity-0" : "press-row cursor-pointer hover:bg-accent/40",
        selected && !editing && "message-selected",
        pulsing && "message-pulse",
      )}
      // Row-select: click anywhere in the row selects it (toggling off on a re-click of the same
      // row is the caller's job — see `onSelect`), except the actions row and the note chip (see
      // rowSelect.ts) and anything in edit mode, where this is a live editor instead of a message to select.
      // Clicks from a portal (menu, sheet, its scrim) bubble here through React but aren't inside the row.
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node) && shouldSelectRow(e.target as Element, editing)) onSelect();
      }}
      // `initial={false}` starts a history-loaded row already in its resting state — only a
      // message that showed up after the fact (a note you just added, one that synced in) gets
      // the little rise-in; a long thread's first render never animates.
      initial={isNew && !reduceMotion ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {!mine && <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Claude</p>}

      {mine ? (
        <ContentField
          variant="edit"
          handleRef={editor}
          value={m.content}
          readOnly={!editing}
          onDirtyChange={setDirty}
          onSubmit={editing ? save : undefined}
          onCancel={editing ? cancelEdit : undefined}
          onImageFile={editing ? (f) => attach([f]) : undefined}
          onTodoToggle={editing ? undefined : (lineIndex) => onEdit(toggleTodoLine(m.content, lineIndex))}
          onReferenceClick={navigateReference}
          error={imageError ?? undefined}
          leading={<ImageButton onFiles={attach} disabled={busy} />}
          trailing={
            <>
              <Button size="icon" variant="ghost" aria-label="Cancel" title="Cancel" onClick={cancelEdit}>
                <X className="size-5 md:size-4" />
              </Button>
              <Button size="icon" aria-label="Save" title="Save" disabled={busy || !dirty} onClick={save}>
                <Check className="size-5 md:size-4" />
              </Button>
            </>
          }
        />
      ) : (
        <MarkdownEditor readOnly value={m.content} className="[--md-padding:0]" onReferenceClick={navigateReference} />
      )}

      {note && !editing && (
        <div className="-mb-1.5 mt-0.5">
          <ResponsiveOverlay {...overlay}>{noteBody}</ResponsiveOverlay>
        </div>
      )}

      {!editing && selected && (
        // Metadata is only for the message you're looking at. One row-select-ignore zone (rowSelect.ts): the
        // buttons, the ⋯ menu and the "edited" toggle all live here, and none should select the row out from
        // under its own click. The right edge is the text's right edge (`-mr-3` pulls the last 44px circle's
        // box out to the row's padding, so its glyph lines up with the text above).
        <div
          {...{ [ROW_SELECT_IGNORE]: "" }}
          className="-mr-3 mt-1 flex min-h-11 items-center gap-2 text-xs text-muted-foreground"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
            <time className="min-w-0 truncate tabular-nums">{format(m.createdAt, "d MMM HH:mm")}</time>
            {!!m.meta?.voice && <Mic className="size-4 shrink-0" aria-label="voice" />}
            {pending && <CloudOff className="size-4 shrink-0" aria-label="only on this device so far" />}
            {!!m.edits?.length && (
              <button
                type="button"
                aria-expanded={history}
                className="flex h-full shrink-0 items-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
                onClick={() => setHistory((h) => !h)}
              >
                <span
                  className={cn(
                    "press-row rounded-full px-2.5 py-1 transition-colors",
                    history ? "bg-accent text-foreground" : "bg-accent/60",
                  )}
                >
                  edited
                </span>
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            {mine && (
              <>
                <Button size="icon" variant="ghost" aria-label="Edit" title="Edit" onClick={startEdit}>
                  <Pencil className="size-5 md:size-4" />
                </Button>
                {!note && <ResponsiveOverlay {...overlay}>{noteBody}</ResponsiveOverlay>}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Todo"
                  title="Todo"
                  aria-pressed={todo}
                  className="aria-pressed:bg-accent aria-pressed:text-foreground"
                  onClick={() => onSetTodo(todo ? null : false)}
                >
                  {todo ? <SquareCheck className="size-5 md:size-4" /> : <Square className="size-5 md:size-4" />}
                </Button>
              </>
            )}
            <Menu
              align="end"
              trigger={
                <Button size="icon" variant="ghost" aria-label="Message actions" title="Message actions">
                  <MoreHorizontal className="size-5 md:size-4" />
                </Button>
              }
              items={[
                { label: "Copy", icon: Copy, onClick: copyText },
                { label: "Copy link", icon: Link, onClick: copyLink },
                { label: "Clone from here", icon: GitBranchPlus, onClick: onCopyThread },
              ]}
            />
          </div>
        </div>
      )}

      {history &&
        selected &&
        !editing &&
        [...(m.edits ?? [])].reverse().map((v) => (
          <div key={v.at} className="mt-2 border-l-2 border-border pl-3 opacity-70">
            <p className="text-xs tabular-nums text-muted-foreground">{format(v.at, "d MMM HH:mm")}</p>
            <MarkdownEditor
              readOnly
              value={v.content}
              className="[--md-padding:0]"
              onReferenceClick={navigateReference}
            />
          </div>
        ))}
    </Motion.article>
  );
};

const copy = async (text: string, done: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: done });
  } catch (e) {
    toast({ title: "Copy failed", description: errorMessage(e) });
  }
};

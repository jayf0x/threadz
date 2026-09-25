import { format } from "date-fns";
import { Check, CloudOff, Pencil, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContentField,
  ImageButton,
  MarkdownEditor,
  type MarkdownEditorHandle,
  useImageAttach,
} from "@/features/editor";
import type { Annotation } from "@/lib/types";

// The inside of a message's note overlay (`ResponsiveOverlay`: a sheet on a phone, a popover from md).
// It mounts when the overlay opens, so a reopened note always starts on its quiet read view; composing a
// brand-new note keeps its draft in the row (`draft`) so an accidental dismiss doesn't eat it.
export const NoteSurface = ({
  note,
  unsynced,
  busy,
  draft,
  onDraftChange,
  onAdd,
  onEdit,
  onDelete,
  onClose,
  onNavigateReference,
}: {
  note: Annotation | undefined;
  unsynced: boolean;
  busy: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onAdd: (text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
  onNavigateReference: (threadId: string, messageId: string | null) => void;
}) => {
  const [editing, setEditing] = useState(!note); // nothing to read yet, or editing what's there
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(note?.content ?? draft);
  const [dirty, setDirty] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const { attach, error } = useImageAttach(editor);
  const canSave = !busy && (note ? dirty : !!text.trim());

  const change = (next: string) => {
    setText(next);
    if (!note) onDraftChange(next);
  };
  const cancel = () => {
    if (note) setEditing(false);
    else onClose();
  };
  const save = async () => {
    const next = (editor.current?.getMarkdown() ?? text).trim();
    if (!next) return;
    if (note) {
      if (editor.current?.isDirty() && (await onEdit(note.id, next))) setEditing(false);
    } else {
      // Close first: once the note exists the row swaps this overlay's trigger (the bar's Add-note button
      // for the chip), and a still-open overlay would remount on it. The draft survives a failure.
      onClose();
      if (await onAdd(next)) onDraftChange("");
    }
  };
  const remove = async () => {
    if (note && (await onDelete(note.id))) onClose();
  };

  if (editing)
    return (
      <ContentField
        variant="note"
        className="mb-2 md:mb-0"
        handleRef={editor}
        value={text}
        onChange={change}
        onDirtyChange={setDirty}
        autofocus
        placeholder="Note"
        onSubmit={save}
        onCancel={cancel}
        onImageFile={(f) => attach([f])}
        onReferenceClick={onNavigateReference}
        error={error ?? undefined}
        leading={<ImageButton onFiles={attach} disabled={busy} />}
        trailing={
          <>
            <Button size="icon" variant="ghost" aria-label="Cancel" title="Cancel" onClick={cancel}>
              <X className="size-5 md:size-4" />
            </Button>
            <Button size="icon" aria-label="Save note" title="Save note" disabled={!canSave} onClick={save}>
              <Check className="size-5 md:size-4" />
            </Button>
          </>
        }
      />
    );

  if (!note) return null;
  return (
    <div className="flex flex-col">
      <MarkdownEditor
        readOnly
        value={note.content}
        className="[--md-padding:4px_0_0]"
        onReferenceClick={onNavigateReference}
      />
      <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
        <time className="tabular-nums">{format(note.createdAt, "d MMM HH:mm")}</time>
        {unsynced && <CloudOff className="size-4" aria-label="only on this device so far" />}
        {!!note.edits?.length && <span>edited</span>}
        <div className="ml-auto flex items-center">
          {confirming ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Keep note"
                title="Keep"
                onClick={() => setConfirming(false)}
              >
                <X className="size-5 md:size-4" />
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
                <Trash2 className="size-5 md:size-4" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit note"
                title="Edit note"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-5 md:size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete note"
                title="Delete note"
                className="hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-5 md:size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

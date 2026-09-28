import { Check, X } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContentField,
  ImageButton,
  MarkdownEditor,
  type MarkdownEditorHandle,
  useImageAttach,
} from "@/features/editor";
import { cn } from "@/lib/cn";
import { toggleTodoLine } from "@/lib/todos";
import type { Message } from "@/lib/types";

// Line mode's per-message rendering (ThreadView.tsx, docs/direction.md "Lenses": the same query as
// chat mode, rendered as "one continuous document; coherence possible, never required"). No avatar,
// timestamp, note chip, todo toggle, edit history or ⋯ menu — those are chat-mode chrome tied to a
// selected-row actions row that a continuous document doesn't have (see the phase report for what
// that defers). Editability is preserved (AGENTS.md's "one editor, one field" contract): with no
// actions row to host a separate Edit button, tapping your own message's text enters edit directly,
// the same `ContentField`/`MarkdownEditorHandle` `enterEdit()`/`exitEdit()` instance EntryRow uses.
export const LineEntry = ({
  message: m,
  busy,
  pulsing,
  onEdit,
  onReferenceClick,
}: {
  message: Message;
  busy: boolean;
  pulsing: boolean; // arrival pulse (a `?thread=&msg=` deep link landed here), same as EntryRow's
  onEdit: (text: string) => Promise<boolean>;
  onReferenceClick: (threadId: string, messageId?: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const { attach, error: imageError } = useImageAttach(editor);
  const mine = m.role === "user";
  const navigateReference = (threadId: string, messageId: string | null) =>
    onReferenceClick(threadId, messageId ?? undefined);

  // `enterEdit` runs inside the tap on purpose: iOS raises the keyboard only for a focus() in the gesture.
  const startEdit = () => {
    editor.current?.enterEdit();
    setEditing(true);
  };
  const cancelEdit = () => {
    editor.current?.exitEdit(true);
    setEditing(false);
  };
  const save = async () => {
    const field = editor.current;
    if (!field?.isDirty()) return;
    const next = field.getMarkdown().trim();
    if (next && (await onEdit(next))) {
      field.exitEdit();
      setEditing(false);
    }
  };
  // A click anywhere in a read (not-yet-editing) message starts editing, except on a link — a
  // reference link's own click handler only `preventDefault`s (it still needs App.tsx to navigate),
  // and a plain `https://` link is left to the browser either way, so neither should also flip the
  // paragraph into edit mode underneath the navigation.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!mine || editing || (e.target as Element).closest("a")) return;
    startEdit();
  };

  if (!mine) {
    return (
      <div className={cn("rounded-lg py-1.5 [overflow-wrap:anywhere]", pulsing && "message-pulse")}>
        <MarkdownEditor readOnly value={m.content} className="[--md-padding:0]" onReferenceClick={navigateReference} />
      </div>
    );
  }

  return (
    // A click anywhere on your own message enters edit; the editor itself (and its Save/Cancel
    // buttons) is fully keyboard-reachable once editing starts.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div className={cn("rounded-lg py-1.5 [overflow-wrap:anywhere]", pulsing && "message-pulse")} onClick={onClick}>
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
        leading={editing ? <ImageButton onFiles={attach} disabled={busy} /> : undefined}
        trailing={
          editing ? (
            <>
              <Button size="icon" variant="ghost" aria-label="Cancel" title="Cancel" onClick={cancelEdit}>
                <X className="size-5 md:size-4" />
              </Button>
              <Button size="icon" aria-label="Save" title="Save" disabled={busy || !dirty} onClick={save}>
                <Check className="size-5 md:size-4" />
              </Button>
            </>
          ) : undefined
        }
      />
    </div>
  );
};

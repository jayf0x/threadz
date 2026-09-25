import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

export type ContentFieldVariant = "composer" | "edit" | "note";

// The one look and behaviour for every place text is written: the composer (and its Ask mode),
// editing a message, editing a note. One WYSIWYG editor (`MarkdownEditor`), one surface, one
// keydown contract. Callers put their buttons in the two slots and never touch the editor's chrome.
//
//   +--------------------------------+   phone (and edit/note at any width)
//   | editor                         |
//   | [leading ...]        [trailing]|   48px action row: leading left, trailing right
//   +--------------------------------+
//
// `composer` from `md` up is a side rail instead (AGENTS.md's Composer rule): the same two slots
// stack in a column on the right, `leading` on top and `trailing` at the bottom.
//
// `variant="edit"` + `readOnly` is the *read view of a message*: the same mounted instance, with the
// surface, border and action row switched off. The edit variant carries negative margins that cancel
// its own padding and border (17px sideways, 13px vertically), so the text sits exactly where the plain
// read view puts it. Flip `readOnly` (after `handle.enterEdit()` inside the tap) and the surface fades
// in around the text, growing outward, without the text moving; give the row that much room. See
// `MarkdownEditorHandle` for the whole enter/save/cancel contract. Only `edit` goes bare: the
// composer's `readOnly` (busy) keeps its surface.
export const ContentField = ({
  value,
  onChange,
  placeholder,
  handleRef,
  autofocus,
  readOnly = false,
  variant,
  onSubmit,
  onCancel,
  onImageFile,
  onReferenceClick,
  onTodoToggle,
  onDirtyChange,
  leading,
  trailing,
  error,
  className,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Mount-time focus (a fresh note). Not for edit-in-place: that is `handleRef.enterEdit()`. */
  autofocus?: boolean;
  readOnly?: boolean;
  variant: ContentFieldVariant;
  /** Cmd/Ctrl+Enter. Claimed (not typed into the note) only when provided. */
  onSubmit?: () => void;
  /** Esc, when the reference autocomplete isn't open (that one takes Esc first). Only when provided. */
  onCancel?: () => void;
  onImageFile?: (file: File) => void;
  onReferenceClick?: (threadId: string, messageId: string | null) => void;
  onTodoToggle?: (lineIndex: number) => void;
  /** Edit variants: the text differs from (or is back to) what it was when editing began. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Action row, left. In the composer's side rail: the top of the column. */
  leading?: ReactNode;
  /** Action row, right (send, or cancel/save). In the composer's side rail: the bottom of the column. */
  trailing?: ReactNode;
  /** One line inside the field, under the text (an image that failed to attach). */
  error?: string;
  className?: string;
}) => {
  const bare = variant === "edit" && readOnly;
  const rail = variant === "composer";
  const hasActions = !bare && (leading || trailing);

  return (
    <div
      data-variant={variant}
      className={cn(
        "content-field relative grid rounded-3xl border transition-[border-color,box-shadow] duration-150 ease-out-strong",
        // The edit variant always cancels its own padding + border (17px / 13px), reading or editing,
        // so the text stays put and the surface grows outward around it.
        variant === "edit" && "-mx-[17px] -my-[13px]",
        bare ? "border-transparent" : "surface-sheen border-input focus-within:ring-2 focus-within:ring-ring",
        rail && "md:grid-cols-[minmax(0,1fr)_auto]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <MarkdownEditor
          handleRef={handleRef}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={readOnly}
          autofocus={autofocus}
          onImageFile={onImageFile}
          onReferenceClick={onReferenceClick}
          onTodoToggle={onTodoToggle}
          onDirtyChange={onDirtyChange}
          className={EDITOR_CLASS[bare ? "read" : variant]}
          onKeyDownCapture={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
              e.preventDefault();
              e.stopPropagation();
              onSubmit();
            } else if (e.key === "Escape" && onCancel) {
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        {error && !bare && (
          <p role="alert" className="truncate px-4 pb-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {hasActions && (
        <div
          className={cn(
            "flex min-h-12 items-center justify-between gap-1 px-2 pb-2",
            rail && "md:flex-col md:py-2 md:pr-2 md:pb-2 md:pl-0",
          )}
        >
          <div className={cn("flex items-center gap-1", rail && "md:flex-col")}>{leading}</div>
          <div className="flex items-center gap-1">{trailing}</div>
        </div>
      )}
    </div>
  );
};

// Metrics are CSS vars read by markdown-editor.css. The type scale is the read view's (16px on a
// phone, never smaller: iOS zooms the page on focus otherwise), so a message doesn't change size
// when it turns editable. Heights follow the visible area (`--vv-h`), not `dvh`, so they hold with
// the keyboard up.
const EDITOR_CLASS: Record<ContentFieldVariant | "read", string> = {
  composer:
    "threadz-md-scroll [--md-min-height:2.75rem] md:[--md-min-height:9rem] [--md-max-height:calc(var(--vv-h,100dvh)*0.45)] [--md-padding:12px_16px_4px] md:[--md-padding:14px_16px_8px] [--md-img-max:12rem]",
  edit: "threadz-md-scroll [--md-min-height:0px] [--md-max-height:calc(var(--vv-h,100dvh)*0.6)] [--md-padding:12px_16px]",
  note: "threadz-md-scroll [--md-min-height:5rem] [--md-max-height:calc(var(--vv-h,100dvh)*0.4)] [--md-padding:12px_16px] [--md-img-max:12rem]",
  read: "[--md-min-height:0px] [--md-padding:12px_16px]",
};

import type { ReactNode, Ref } from "react";
import { useImperativeHandle } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ImageButton, MarkdownEditor } from "@/features/editor";
import { cn } from "@/lib/cn";
import { useMessageInput } from "./useMessageInput";

export type MessageInputHandle = {
  /** Insert text at the caret (dictation, in the composer). No-op capability of its own here —
   * the composer owns voice; this just gives it somewhere to land. */
  insertAtCaret: (text: string) => void;
  /** Current typed text, without sending or clearing it (the composer's "copy thread from here"
   * reads this to carry it over as the copy's next note). */
  getText: () => string;
  /** Clears the draft — call only once whatever read it with `getText` has actually succeeded. */
  clear: () => void;
};

type Status = { text: string; tone: "error" | "ghost" | "quiet" } | null;

export type MessageInputProps = {
  /** Keys the persisted draft — a thread id, or e.g. `annotation:${messageId}`. */
  draftKey: string;
  placeholder: string;
  busy: boolean;
  onSubmit: (text: string) => Promise<boolean>;
  /** Called after a successful send with whatever text is left in the box. */
  onSubmitted?: (rest: string) => void;
  submitLabel: ReactNode;
  /** Accessible name for the submit button — needed when `submitLabel` is icon-only. */
  submitAriaLabel?: string;
  /** Defaults to the regular text-button size; pass `"icon"` when `submitLabel` is icon-only. */
  submitButtonSize?: ButtonProps["size"];
  /** Extra buttons overlaid on the editor (the composer's mic button), absolutely positioned by the caller. */
  overlay?: ReactNode;
  /** Extra controls in the bottom row, before the submit button (the composer's mode toggle / checkbox). */
  controls?: ReactNode;
  /** A status line to show instead of the image-attach error (the composer's voice status). */
  statusOverride?: Status;
  /** Extra actions right beside the submit button (the composer's ⋯ menu). */
  trailingActions?: ReactNode;
  className?: string;
  editorClassName?: string;
  handleRef?: Ref<MessageInputHandle>;
  /** Focus the editor once it's ready (a `/capture` deep link landing straight in a fresh
   * thread). Mount-time only — see `MarkdownEditor`'s `autofocus`. */
  autofocus?: boolean;
};

// The composer's editor, draft, image attach and send — with nothing composer-specific (no voice,
// no mode toggle). `Composer` wraps this and adds those; an annotation input can use it as-is.
export const MessageInput = ({
  draftKey,
  placeholder,
  busy,
  onSubmit,
  onSubmitted,
  submitLabel,
  submitAriaLabel,
  submitButtonSize,
  overlay,
  controls,
  statusOverride,
  trailingActions,
  className,
  editorClassName,
  handleRef,
  autofocus,
}: MessageInputProps) => {
  const { draft, setDraft, editor, attach, imageError, submit, insertAtCaret, getText, clear } = useMessageInput(
    draftKey,
    busy,
    onSubmit,
  );

  useImperativeHandle(handleRef, () => ({ insertAtCaret, getText, clear }), [insertAtCaret, getText, clear]);

  const send = async () => {
    const rest = await submit();
    if (rest !== null) onSubmitted?.(rest);
  };

  const status = statusOverride ?? (imageError ? { text: imageError, tone: "error" as const } : null);

  return (
    <div className={className}>
      <div className="relative">
        <MarkdownEditor
          handleRef={editor}
          value={draft}
          onChange={setDraft}
          readOnly={busy}
          onImageFile={(f) => attach([f])}
          placeholder={placeholder}
          autofocus={autofocus}
          className={cn(
            "rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring",
            "[--md-max-height:45dvh] [--md-min-height:10rem] md:[--md-min-height:14rem] [--md-padding:12px_64px_12px_14px] [--md-img-max:12rem]",
            editorClassName,
          )}
          onKeyDownCapture={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              send();
            }
          }}
        />
        <ImageButton onFiles={attach} disabled={busy} className="absolute right-2 top-11" />
        {overlay}
      </div>

      <div className="mt-1 h-4" aria-live="polite">
        {status && (
          <p
            className={cn(
              "truncate font-mono text-[11px]",
              status.tone === "error" && "text-destructive",
              status.tone === "ghost" && "italic text-foreground/70",
              status.tone === "quiet" && "text-muted-foreground",
            )}
          >
            {status.text}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {controls}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size={submitButtonSize}
            aria-label={submitAriaLabel}
            title={submitAriaLabel}
            disabled={busy || !draft.trim()}
            onClick={send}
          >
            {submitLabel}
          </Button>
          {trailingActions}
        </div>
      </div>
    </div>
  );
};

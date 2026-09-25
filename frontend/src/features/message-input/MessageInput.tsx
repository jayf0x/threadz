import type { ReactNode, Ref } from "react";
import { useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { ContentField, ImageButton } from "@/features/editor";
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
  /** Focus the editor (dictation start — see Composer). */
  focus: () => void;
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
  /** The icon inside the send button. */
  submitLabel: ReactNode;
  /** Accessible name for the send button (it is icon-only). */
  submitAriaLabel?: string;
  /** Actions after the attach button: the composer's mic. */
  leadingActions?: ReactNode;
  /** The composer's ⋯ menu, last of the secondary actions. */
  overflowActions?: ReactNode;
  /** Controls above the field (the composer's Note/Ask toggle and "Keep exchange"). */
  controls?: ReactNode;
  /** A status line to show instead of the image-attach error (the composer's voice status). */
  statusOverride?: Status;
  /** A completed reference (`lib/references.ts`) was clicked in the editor. */
  onReferenceClick?: (threadId: string, messageId: string | null) => void;
  className?: string;
  handleRef?: Ref<MessageInputHandle>;
  /** Focus the editor once it's ready (a `/capture` deep link landing straight in a fresh
   * thread). Mount-time only — see `MarkdownEditor`'s `autofocus`. */
  autofocus?: boolean;
};

// The composer's field, draft, image attach and send — with nothing composer-specific (no voice,
// no mode toggle). `Composer` wraps this and adds those.
export const MessageInput = ({
  draftKey,
  placeholder,
  busy,
  onSubmit,
  onSubmitted,
  submitLabel,
  submitAriaLabel,
  leadingActions,
  overflowActions,
  controls,
  statusOverride,
  onReferenceClick,
  className,
  handleRef,
  autofocus,
}: MessageInputProps) => {
  const { draft, setDraft, editor, attach, imageError, submit, insertAtCaret, getText, clear, focus } = useMessageInput(
    draftKey,
    busy,
    onSubmit,
  );

  useImperativeHandle(handleRef, () => ({ insertAtCaret, getText, clear, focus }), [
    insertAtCaret,
    getText,
    clear,
    focus,
  ]);

  const send = async () => {
    const rest = await submit();
    if (rest !== null) onSubmitted?.(rest);
  };

  const status = statusOverride ?? (imageError ? { text: imageError, tone: "error" as const } : null);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden">{controls}</div>

      {/* Phone: editor on top, [attach mic ⋯] left and send far right underneath. From `md`, the
          same slots become a side rail (attach, mic, ⋯ on top; send last, at the bottom). At most
          three primary actions besides send: anything else goes in the ⋯ menu. */}
      <ContentField
        variant="composer"
        handleRef={editor}
        value={draft}
        onChange={setDraft}
        readOnly={busy}
        placeholder={placeholder}
        autofocus={autofocus}
        onImageFile={(f) => attach([f])}
        onReferenceClick={onReferenceClick}
        onSubmit={send}
        leading={
          <>
            <ImageButton onFiles={attach} disabled={busy} />
            {leadingActions}
            {overflowActions}
          </>
        }
        trailing={
          <Button
            size="icon"
            aria-label={submitAriaLabel}
            title={submitAriaLabel}
            disabled={busy || !draft.trim()}
            onClick={send}
            // keep the caret where the user left it (and the keyboard up) through the tap
            onPointerDown={(e) => e.preventDefault()}
            className="size-11 rounded-full bg-primary-sheen text-primary-foreground shadow-md shadow-primary/30 press active:scale-[.94] disabled:opacity-40 md:size-9"
          >
            {submitLabel}
          </Button>
        }
      />

      {/* No reserved height: a permanently empty line under the field was dead space, worst with
          the keyboard up. It exists only while there's something to say. */}
      <div aria-live="polite">
        {status && (
          <p
            className={cn(
              "mt-1.5 truncate px-4 text-xs",
              status.tone === "error" && "text-destructive",
              status.tone === "ghost" && "italic text-foreground/70",
              status.tone === "quiet" && "text-muted-foreground",
            )}
          >
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
};

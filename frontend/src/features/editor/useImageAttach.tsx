import { ImagePlus } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { addImage } from "@/lib/imageSync";
import type { MarkdownEditorHandle } from "./MarkdownEditor";

// Photos for any MarkdownEditor: a picked / pasted / dropped file is compressed and stored on this
// device, then dropped into the note at the caret. `error` is the last failure, for the caller to show.
export const useImageAttach = (editor: RefObject<MarkdownEditorHandle | null>) => {
  const [error, setError] = useState<string | null>(null);

  const attach = async (files: Iterable<File>) => {
    setError(null);
    for (const file of files) {
      try {
        editor.current?.insertImage(await addImage(file));
      } catch (e) {
        setError(errorMessage(e));
      }
    }
  };

  return { attach, error };
};

// The "Add photo" button plus its hidden file input. Position it with `className`.
export const ImageButton = ({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}) => {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Add photo"
        title="Add photo"
        className={cn("press-icon", className)}
        disabled={disabled}
        onClick={() => picker.current?.click()}
        // keep the caret where the user left it: don't let the tap blur/refocus the editor
        onPointerDown={(e) => e.preventDefault()}
      >
        <ImagePlus className="size-5 md:size-4" />
      </Button>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = ""; // picking the same photo again must fire again
        }}
      />
    </>
  );
};

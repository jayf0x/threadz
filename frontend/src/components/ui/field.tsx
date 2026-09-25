import { type InputHTMLAttributes, useId } from "react";
import { cn } from "@/lib/cn";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Keep the label for assistive tech only (the surrounding UI already names the field). */
  hideLabel?: boolean;
  error?: string;
};

/** Label + input + hint/error, one owned unit — so a form never re-derives the
 * label/aria-describedby wiring by hand per field. */
export const Field = ({ label, hint, hideLabel, error, id, className, ...props }: FieldProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={cn("px-1 text-sm font-medium text-foreground", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={messageId}
        className={cn(
          "h-11 rounded-full border border-input bg-input px-4 text-base text-foreground outline-none md:h-9 md:text-sm",
          "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
          error && "border-destructive focus-visible:ring-destructive",
          className,
        )}
        {...props}
      />
      {(hint || error) && (
        <p id={messageId} className={cn("px-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
};

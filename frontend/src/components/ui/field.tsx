import { type InputHTMLAttributes, useId } from "react";
import { cn } from "@/lib/cn";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

/** Label + input + hint/error, one owned unit — so a form never re-derives the
 * label/aria-describedby wiring by hand per field. */
export const Field = ({ label, hint, error, id, className, ...props }: FieldProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={messageId}
        className={cn(
          "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none",
          "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
          error && "border-destructive focus-visible:ring-destructive",
          className,
        )}
        {...props}
      />
      {(hint || error) && (
        <p id={messageId} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
};

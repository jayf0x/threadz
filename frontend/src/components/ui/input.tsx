import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Bare controls, same look as twinz `Field`'s input — for places a visible label would be noise
// (search box, composer). Candidate to upstream into twinz's field.tsx.
const shared =
  "w-full rounded-md border border-input bg-background text-foreground outline-none " +
  "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(shared, "h-9 px-3 text-sm", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(shared, "resize-none px-3 py-2 text-[15px] leading-relaxed", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

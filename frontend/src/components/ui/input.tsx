import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Bare controls, same look as the shared design system's `Field` input — for places a visible
// label would be noise (search box, composer).
const shared =
  "w-full rounded-md border border-input bg-background text-foreground outline-none " +
  "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    // text-base below md: iOS Safari auto-zooms the page on focus when a field's font-size is
    // under 16px, and doesn't always zoom back out on blur (markdown-editor.css has the same fix).
    <input ref={ref} className={cn(shared, "h-10 px-3 text-base md:h-9 md:text-sm", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(shared, "resize-none px-3 py-2 text-base leading-relaxed md:text-[15px]", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

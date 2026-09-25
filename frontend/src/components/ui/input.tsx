import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Bare controls for places a visible label would be noise (search box, rename). A single-line field is a
// pill; a multi-line one is a rounded card.
const shared =
  "w-full border border-input bg-input text-foreground outline-none " +
  "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    // text-base below md: iOS Safari auto-zooms the page on focus when a field's font-size is
    // under 16px, and doesn't always zoom back out on blur (markdown-editor.css has the same fix).
    <input
      ref={ref}
      className={cn(shared, "h-11 rounded-full px-4 text-base md:h-9 md:text-sm", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(shared, "resize-none rounded-2xl px-4 py-2.5 text-base leading-relaxed md:text-[15px]", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

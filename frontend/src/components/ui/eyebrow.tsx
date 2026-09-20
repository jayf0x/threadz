import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** The small mono uppercase caption used for section labels and counters. */
export const Eyebrow = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("font-mono text-[11px] uppercase tracking-widest text-muted-foreground", className)} {...props} />
);

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** An empty list: a quiet icon and at most two words. */
export const Empty = ({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: string;
  className?: string;
}) => (
  <div className={cn("flex flex-col items-center gap-2 px-5 py-16 text-muted-foreground", className)}>
    <Icon aria-hidden className="size-8 stroke-[1.5]" />
    <p className="text-sm">{children}</p>
  </div>
);

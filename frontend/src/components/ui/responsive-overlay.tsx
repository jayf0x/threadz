import * as Popover from "@radix-ui/react-popover";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/useMedia";
import { Sheet } from "./sheet";

export type ResponsiveOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger: tapping it toggles the overlay (Radix wires that up, and it isn't mistaken for an
   * outside click). It is also what the popover anchors to on wide screens. */
  anchor: ReactElement;
  /** Accessible name; not drawn. */
  title: string;
  children: ReactNode;
  className?: string;
};

// The one surface for "a small form or note tied to something on screen": a Radix Popover from 768px up,
// a bottom Sheet on a phone (a popover next to a keyboard has nowhere to go). Same children either way.
export const ResponsiveOverlay = ({
  open,
  onOpenChange,
  anchor,
  title,
  children,
  className,
}: ResponsiveOverlayProps) => {
  const wide = useMedia("(min-width: 768px)");

  if (!wide)
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} trigger={anchor} className={className}>
        {children}
      </Sheet>
    );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{anchor}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={title}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "pop-in surface-float z-50 w-80 max-w-[min(20rem,var(--radix-popover-content-available-width))]",
            "rounded-2xl p-3 shadow-lg outline-none ring-1 ring-border",
            className,
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

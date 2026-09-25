import * as Dialog from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read by screen readers only; the sheet's own content is its visible heading. */
  title: string;
  children: ReactNode;
  /** An element that opens the sheet when tapped (optional: `open` is controlled either way). */
  trigger?: ReactElement;
  className?: string;
};

// A bottom sheet: Radix Dialog (focus trap, scroll lock, Escape, outside-tap all Radix's) styled as a
// docked surface. It sits on the *visual* viewport (`--vv-h`/`--vv-top`, lib/viewport.ts), so with the
// iOS keyboard up it rides on top of it instead of underneath. The enter/exit are CSS keyframes on
// `data-state`, Radix Presence's documented path; there is no swipe-to-dismiss yet.
export const Sheet = ({ open, onOpenChange, title, children, trigger, className }: SheetProps) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className="scrim-in fixed inset-0 z-50 bg-foreground/40 data-[state=closed]:scrim-out" />
      <Dialog.Content
        aria-describedby={undefined}
        style={{ bottom: "max(0px, calc(100dvh - var(--vv-top, 0px) - var(--vv-h, 100dvh)))" }}
        className={cn(
          "sheet-in fixed inset-x-0 z-50 flex max-h-[calc(var(--vv-h,100dvh)-1rem)] flex-col rounded-t-3xl",
          "surface-float shadow-xl outline-none ring-1 ring-border data-[state=closed]:sheet-out",
          className,
        )}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
        <div className="pb-safe min-h-0 flex-1 overflow-y-auto px-4 pt-3">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

import {
  type CSSProperties,
  cloneElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Align = "start" | "end";

export type PopoverTrigger = {
  onClick?: (e: MouseEvent) => void;
  ref?: Ref<HTMLElement>;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: string;
  "aria-controls"?: string;
};

export type PopoverProps = {
  /** The element that opens the popover. Cloned with a ref, click handler and `aria-expanded`. */
  trigger: ReactElement<PopoverTrigger>;
  /** Panel content. A function form gets `close()`, for an item that should dismiss on click (see `Menu`). */
  children: ReactNode | ((args: { close: () => void }) => ReactNode);
  /** Which edge of the trigger the panel hangs from. Ignored in the phone bottom-sheet layout. */
  align?: Align;
  className?: string;
};

// Below this, ThreadView's back button etc. switch to the phone layout too (see App.tsx / ThreadView.tsx `lg:`).
const PHONE_QUERY = "(max-width: 1023px)";

/** Trigger + floating content: outside click/tap and Escape close it, portalled to <body> (so the
 * thread pane's `overflow-y-auto` can't clip it) and positioned with `fixed`, not inline. On a phone
 * it renders as a bottom sheet instead of an anchored panel. Built to be the base for `Menu`. */
export const Popover = ({ trigger, children, align = "start", className }: PopoverProps) => {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const panelId = useId();

  const close = () => setOpen(false);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStyle(
      align === "end"
        ? { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }
        : { top: rect.bottom + 6, left: Math.max(8, rect.left) },
    );
  };

  // Position on open (and keep it correct across scroll/resize — capture:true reaches a scroll
  // inside the thread pane, not just the window).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reposition is redefined every render (it reads align/triggerRef); it isn't a reactive value itself.
  useEffect(() => {
    if (!open || phone) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, phone, align]);

  // Outside click/tap and Escape close it; Escape returns focus to the trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close is a stable setOpen(false) wrapper, not a reactive value.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Keyboard reachable: focus lands inside the panel as soon as it opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const clonedTrigger = cloneElement(trigger, {
    ref: triggerRef,
    "aria-expanded": open,
    "aria-haspopup": "true",
    "aria-controls": open ? panelId : undefined,
    onClick: (e: MouseEvent) => {
      trigger.props.onClick?.(e);
      setOpen((o) => !o);
    },
  });

  const content = typeof children === "function" ? children({ close }) : children;

  return (
    <>
      {clonedTrigger}
      {open &&
        createPortal(
          phone ? (
            <>
              <div aria-hidden className="fixed inset-0 z-50 bg-foreground/20" onClick={close} />
              <div
                id={panelId}
                ref={panelRef}
                tabIndex={-1}
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-lg border-t border-border",
                  "bg-card pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg outline-none",
                  className,
                )}
              >
                {content}
              </div>
            </>
          ) : (
            <div
              id={panelId}
              ref={panelRef}
              tabIndex={-1}
              style={{ position: "fixed", ...style }}
              className={cn("z-50 min-w-40 rounded-md border border-border bg-card shadow-lg outline-none", className)}
            >
              {content}
            </div>
          ),
          document.body,
        )}
    </>
  );
};

const useIsPhone = () => {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
};

import { AnimatePresence, m, useReducedMotion } from "motion/react";
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

export type Align = "start" | "end";

// Conservative fallback for the "will it fit below?" check before the panel has painted once
// (so its real height can be measured). Most menus are well under this.
const MIN_PANEL_HEIGHT = 200;

/** Pure, so it's testable without a DOM: bottom-anchors (opens upward) instead of top-anchoring
 * when the trigger is close enough to the bottom of the viewport that the panel wouldn't fit
 * below it. Horizontal clamping is unchanged. */
export const computePopoverPosition = (
  align: Align,
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  panelHeight: number,
  viewport: { width: number; height: number },
): CSSProperties => {
  const spaceBelow = viewport.height - rect.bottom;
  const vertical = spaceBelow < panelHeight ? { bottom: viewport.height - rect.top + 6 } : { top: rect.bottom + 6 };
  const horizontal =
    align === "end" ? { right: Math.max(8, viewport.width - rect.right) } : { left: Math.max(8, rect.left) };
  return { ...vertical, ...horizontal };
};

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
  const reduceMotion = useReducedMotion();

  const close = () => setOpen(false);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? MIN_PANEL_HEIGHT;
    setStyle(
      computePopoverPosition(align, rect, panelHeight, { width: window.innerWidth, height: window.innerHeight }),
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

  // Enter is a touch slower than exit (ease-out vs ease-in) — a common feel for UI chrome: it
  // arrives with a little give, then gets out of the way promptly. `reduceMotion` collapses both
  // to an instant opacity swap instead of skipping the animation outright, so the panel still
  // reads as appearing/disappearing rather than just popping (AnimatePresence needs *something*
  // to animate to know when it's safe to unmount).
  const enter = reduceMotion ? { duration: 0.01 } : { duration: 0.16, ease: "easeOut" as const };
  const exit = reduceMotion ? { duration: 0.01 } : { duration: 0.12, ease: "easeIn" as const };

  // AnimatePresence must directly own the elements it's tracking — a portal is a React Portal
  // object, not a real element (`isValidElement` is false for it), so AnimatePresence silently
  // drops it if it's the thing being conditionally rendered. Portal the *always-present*
  // AnimatePresence itself instead, and let it conditionally render real `m.div`s inside.
  return (
    <>
      {clonedTrigger}
      {createPortal(
        <AnimatePresence>
          {open &&
            (phone ? (
              <>
                <m.div
                  key="backdrop"
                  aria-hidden
                  className="fixed inset-0 z-50 bg-foreground/20"
                  onClick={close}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: enter }}
                  exit={{ opacity: 0, transition: exit }}
                />
                <m.div
                  key="sheet"
                  id={panelId}
                  ref={panelRef}
                  tabIndex={-1}
                  className={cn(
                    "fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-lg border-t border-border",
                    "bg-card pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg outline-none",
                    className,
                  )}
                  initial={{ y: "100%" }}
                  animate={{ y: 0, transition: enter }}
                  exit={{ y: "100%", transition: exit }}
                >
                  {content}
                </m.div>
              </>
            ) : (
              <m.div
                key="panel"
                id={panelId}
                ref={panelRef}
                tabIndex={-1}
                style={{ position: "fixed", ...style }}
                className={cn(
                  "z-50 min-w-40 rounded-md border border-border bg-card shadow-lg outline-none",
                  className,
                )}
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: enter }}
                exit={{ opacity: 0, scale: 0.96, y: -4, transition: exit }}
              >
                {content}
              </m.div>
            ))}
        </AnimatePresence>,
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

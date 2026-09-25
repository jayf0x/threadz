import * as RadixToast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/useMedia";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  title: string;
  description?: string;
  action?: ToastAction;
  /** ms before it auto-dismisses. Radix's own default (5000) applies when omitted. */
  duration?: number;
};

type ToastItem = ToastOptions & { id: string };

// Module-level queue, same shape as `lib/status.ts` / `lib/settings.ts`: a plain store plus
// `useSyncExternalStore`, so `toast()` can be called from anywhere (an event handler, a promise
// callback) without a context lookup, while `ToastProvider` still re-renders on every change.
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getItems = () => items;

const dismiss = (id: string) => {
  items = items.filter((item) => item.id !== id);
  notify();
};

/** Queue a toast from anywhere. `ToastProvider` (mounted once near the app root) renders it. */
export const toast = (options: ToastOptions) => {
  items = [...items, { ...options, id: crypto.randomUUID() }];
  notify();
};

/** Hook form of `toast`, for components that read their other actions off hooks. */
export const useToast = () => ({ toast });

/** Radix's toast context + viewport, once per app — wrap the tree with this near the root
 * (see `App.tsx`'s other once-per-app wrappers) and call `toast()` from anywhere underneath. */
/** Radix's toast context + viewport, once per app — wrap the tree with this near the root
 * (see `App.tsx`'s other once-per-app wrappers) and call `toast()` from anywhere underneath. On a phone
 * they drop from the top (the bottom is the New pill, the tab bar and the composer); from `md` up they
 * sit bottom-right. */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const queued = useSyncExternalStore(subscribe, getItems);
  const wide = useMedia("(min-width: 768px)");

  return (
    <RadixToast.Provider swipeDirection={wide ? "right" : "up"}>
      {children}
      {queued.map((item) => (
        <RadixToast.Root
          key={item.id}
          duration={item.duration}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
          className={cn(
            "toast-in surface-float flex items-center gap-2 rounded-2xl py-2 pl-4 pr-2 shadow-lg ring-1 ring-border",
            "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:translate-y-0 data-[swipe=cancel]:transition-transform",
            "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]",
            "data-[swipe=end]:opacity-0 data-[swipe=end]:transition-opacity",
          )}
        >
          <div className="min-w-0 flex-1 py-1">
            <RadixToast.Title className="truncate text-[15px] font-medium text-foreground md:text-sm">
              {item.title}
            </RadixToast.Title>
            {item.description && (
              <RadixToast.Description className="line-clamp-2 text-xs text-muted-foreground">
                {item.description}
              </RadixToast.Description>
            )}
          </div>
          {item.action && (
            <RadixToast.Action altText={item.action.label} asChild>
              <Button variant="secondary" size="sm" onClick={item.action.onClick} className="shrink-0">
                {item.action.label}
              </Button>
            </RadixToast.Action>
          )}
          <RadixToast.Close
            aria-label="Dismiss"
            className="press-icon grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-8"
          >
            <X className="size-5 md:size-4" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport
        className={cn(
          "fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex flex-col gap-2 outline-none",
          "md:inset-x-auto md:bottom-4 md:right-4 md:top-auto md:w-96",
        )}
      />
    </RadixToast.Provider>
  );
};

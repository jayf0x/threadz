import * as RadixToast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

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
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const queued = useSyncExternalStore(subscribe, getItems);

  return (
    <RadixToast.Provider swipeDirection="right">
      {children}
      {queued.map((item) => (
        <RadixToast.Root
          key={item.id}
          duration={item.duration}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
          className={cn(
            "rise flex items-start gap-3 rounded-md border border-border bg-card p-3 pr-2 shadow-lg",
            "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform",
            "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
            "data-[swipe=end]:opacity-0 data-[swipe=end]:transition-opacity",
          )}
        >
          <div className="min-w-0 flex-1">
            <RadixToast.Title className="text-sm font-medium text-foreground">{item.title}</RadixToast.Title>
            {item.description && (
              <RadixToast.Description className="mt-0.5 text-xs text-muted-foreground">
                {item.description}
              </RadixToast.Description>
            )}
          </div>
          {item.action && (
            <RadixToast.Action altText={item.action.label} asChild>
              <button
                type="button"
                onClick={item.action.onClick}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.action.label}
              </button>
            </RadixToast.Action>
          )}
          <RadixToast.Close
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
};

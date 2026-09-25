import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** A native <select>, not a listbox rebuilt in divs — the platform already
 * gives keyboard nav, type-ahead and mobile pickers for free. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <div className="relative inline-block">
    <select
      ref={ref}
      className={cn(
        "h-11 w-full appearance-none rounded-full border border-input bg-input py-0 pl-4 pr-10 text-base md:h-9 md:text-sm",
        "text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
));
Select.displayName = "Select";

/** A native <select> drawn as a round icon button: the icon is all you see, the (transparent) select on
 * top opens the platform's own picker. `aria-label` names it. */
export const IconSelect = forwardRef<HTMLSelectElement, SelectProps & { icon: LucideIcon }>(
  ({ icon: Icon, className, children, ...props }, ref) => (
    <div
      className={cn(
        "press-icon relative grid size-11 shrink-0 place-items-center rounded-full border border-input bg-input text-muted-foreground md:size-9",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        className,
      )}
    >
      <Icon aria-hidden className="pointer-events-none size-5 md:size-4" />
      <select
        ref={ref}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0 outline-none"
        {...props}
      >
        {children}
      </select>
    </div>
  ),
);
IconSelect.displayName = "IconSelect";

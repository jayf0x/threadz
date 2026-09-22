import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/cn";
import { Popover, type PopoverTrigger } from "./popover";

export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
};

export type MenuProps = {
  trigger: ReactElement<PopoverTrigger>;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
};

/** A list of actions behind a trigger, built on `Popover` — its outside-click/Escape/portal/bottom-sheet
 * behaviour applies unchanged. Enter/Space activates an item (native `<button>`); Escape closes. */
export const Menu = ({ trigger, items, align, className }: MenuProps) => (
  <Popover trigger={trigger} align={align} className={className}>
    {({ close }) => (
      <div role="menu" className="flex flex-col py-1">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-left text-sm outline-none",
              "hover:bg-accent focus-visible:bg-accent",
              item.destructive ? "text-destructive" : "text-foreground",
            )}
            onClick={() => {
              item.onClick();
              close();
            }}
          >
            {item.icon && <item.icon className="size-4" />}
            {item.label}
          </button>
        ))}
      </div>
    )}
  </Popover>
);

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
};

export type MenuProps = {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
};

// A list of actions behind a trigger. Built on Radix's DropdownMenu, not a hand-rolled popover:
// positioning (flips/shifts to stay on screen), the portal, outside-click, Escape, and focus
// management are all Radix's — a hand-rolled version of exactly this broke twice in one week
// (see AGENTS.md's Motion/primitives note). Selecting an item closes the menu on its own.
export const Menu = ({ trigger, items, align = "start", className }: MenuProps) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-md border border-border bg-card/90 py-1 shadow-lg outline-none backdrop-blur-md",
          className,
        )}
      >
        {items.map((item) => (
          <DropdownMenu.Item
            key={item.label}
            onSelect={item.onClick}
            className={cn(
              "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none",
              "hover:bg-accent focus-visible:bg-accent data-[highlighted]:bg-accent",
              item.destructive ? "text-destructive" : "text-foreground",
            )}
          >
            {item.icon && <item.icon className="size-4" />}
            {item.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

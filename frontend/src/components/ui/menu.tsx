import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ComponentType, ReactElement } from "react";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  icon?: ComponentType<{ className?: string }>; // a lucide icon, or a custom one with the same className contract
  onClick: () => void;
  destructive?: boolean;
};

export type MenuProps = {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
  /** Radix hands focus back to the trigger when the menu closes; preventDefault here to keep it
   * where an action just put it (e.g. an item that opens a popover with an autofocused field). */
  onCloseAutoFocus?: (e: Event) => void;
};

// A list of actions behind a trigger. Built on Radix's DropdownMenu, not a hand-rolled popover:
// positioning (flips/shifts to stay on screen), the portal, outside-click, Escape, and focus
// management are all Radix's — a hand-rolled version of exactly this broke twice in one week
// (see AGENTS.md's Motion/primitives note). Selecting an item closes the menu on its own.
export const Menu = ({ trigger, items, align = "start", className, onCloseAutoFocus }: MenuProps) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        onCloseAutoFocus={onCloseAutoFocus}
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
              "flex cursor-pointer items-center gap-2.5 px-3 py-3 text-sm outline-none md:gap-2 md:py-2",
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

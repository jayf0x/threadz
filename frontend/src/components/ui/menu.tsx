import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ComponentType, Fragment, type ReactElement, useRef } from "react";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  icon?: ComponentType<{ className?: string }>; // a lucide icon, or a custom one with the same className contract
  onClick: () => void;
  destructive?: boolean;
  /** Radix hands focus back to the trigger after an item closes the menu; set this on an item that
   * moves focus itself (Edit, which focuses the editor inside the tap) so it isn't stolen back. */
  keepFocus?: boolean;
};

export type MenuProps = {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  /** Which side of the trigger it opens on; "top" for a trigger in the bottom of the screen. */
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  /** Menu-wide version of `keepFocus`. */
  onCloseAutoFocus?: (e: Event) => void;
};

// A list of actions behind a trigger. Built on Radix's DropdownMenu, not a hand-rolled popover:
// positioning (flips/shifts to stay on screen), the portal, outside-click, Escape, and focus
// management are all Radix's — a hand-rolled version of exactly this broke twice in one week
// (see AGENTS.md's Motion/primitives note). Selecting an item closes the menu on its own. A
// separator is drawn before a destructive item that follows others.
export const Menu = ({ trigger, items, align = "start", side, className, onCloseAutoFocus }: MenuProps) => {
  const keepFocus = useRef(false);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          onCloseAutoFocus={(e) => {
            if (keepFocus.current) e.preventDefault();
            keepFocus.current = false;
            onCloseAutoFocus?.(e);
          }}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "pop-in surface-float z-50 min-w-56 max-w-[min(20rem,var(--radix-dropdown-menu-content-available-width))]",
            "rounded-2xl p-1.5 shadow-lg outline-none ring-1 ring-border",
            className,
          )}
        >
          {items.map((item, i) => (
            <Fragment key={item.label}>
              {item.destructive && i > 0 && <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-border" />}
              <DropdownMenu.Item
                onSelect={() => {
                  keepFocus.current = item.keepFocus === true;
                  item.onClick();
                }}
                className={cn(
                  "press-row flex h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-base outline-none md:h-9 md:text-sm",
                  "data-[highlighted]:bg-accent",
                  item.destructive ? "text-destructive" : "text-foreground",
                )}
              >
                {item.icon && (
                  <item.icon
                    className={cn("size-5 shrink-0 md:size-4", !item.destructive && "text-muted-foreground")}
                  />
                )}
                {item.label}
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

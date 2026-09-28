import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/cn";

// The one UI primitive for attached state (docs/direction.md "Lenses": "a chip is a value, link,
// todo or version marker: a colour slot plus an icon or text as a second cue"). Purely
// presentational — clicking it does whatever its type does (a link navigates, a version opens a
// picker, a todo toggles, a date opens a date picker), but that behavior is the caller's, passed in
// as `onClick`; Chip itself never knows what kind of attached state it's rendering.

// `--chip-1`..`--chip-8` (frontend/src/themes/*.css) are the eight palette slots every family
// defines (docs/direction.md "Colours are palette slots... never hex"); this lookup keeps the
// class names literal so Tailwind's scanner can see them (a template-built `bg-chip-${n}` string
// wouldn't survive the production build's CSS purge).
const SLOT_BG: Record<number, string> = {
  1: "bg-chip-1",
  2: "bg-chip-2",
  3: "bg-chip-3",
  4: "bg-chip-4",
  5: "bg-chip-5",
  6: "bg-chip-6",
  7: "bg-chip-7",
  8: "bg-chip-8",
};

const clampSlot = (slot: number) => Math.min(8, Math.max(1, Math.round(slot)));

export type ChipProps = {
  /** 1-8, a palette slot from `core/schema.ts`'s `property_sets.color_slot`. `null` (a built-in set
   * with no assigned colour, or one not yet set) falls back to a neutral, colourless chip. */
  colorSlot: number | null;
  /** A lucide icon, or a custom one with the same className contract — the second cue besides colour. */
  icon?: ComponentType<{ className?: string }>;
  /** Text label — the second cue when there's no fitting icon, or alongside one. At least one of
   * `icon`/`label` should be given; colour alone is never the only cue. */
  label?: ReactNode;
  /** What clicking this chip does — navigate, open a picker, toggle. `undefined` renders a static,
   * non-interactive chip (e.g. a read-only value in a list). */
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
  title?: string;
};

export const Chip = ({ colorSlot, icon: Icon, label, onClick, className, title, ...aria }: ChipProps) => {
  const bg = colorSlot != null ? SLOT_BG[clampSlot(colorSlot)] : "bg-secondary";
  const fg = colorSlot != null ? "text-chip-foreground" : "text-secondary-foreground";

  const body = (
    <span
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
        bg,
        fg,
        className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {label != null && <span className="truncate">{label}</span>}
    </span>
  );

  if (!onClick) return body;

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="press-icon inline-flex h-11 max-w-full items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
      {...aria}
    >
      {body}
    </button>
  );
};

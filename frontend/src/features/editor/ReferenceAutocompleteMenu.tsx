import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export type ReferenceOption = { id: string; label: string };

// The reference autocomplete's dropdown — popover-shaped, so it's Radix (`@radix-ui/react-popover`,
// the same primitive `ThreadView.tsx`'s note popover uses directly), not hand-rolled. It's a
// different anchoring problem than an icon-triggered popover though: there's no DOM element sitting
// at "the caret," so the caller (RawEditor's textarea wiring via `caretCoordinates.ts`, CrepeEditor's
// ProseMirror wiring via `view.coordsAtPos`) measures that point itself and hands it in as `rect` —
// from there, Radix owns everything a popover normally owns: the portal, flip/shift to stay on
// screen, and outside-click dismissal (`onOpenChange`, wired by the caller straight to closing the
// autocomplete). Escape is deliberately NOT left to Radix: its default handling also tries to return
// focus to a trigger element, which doesn't exist here (focus must stay in the text field the whole
// time this is open) — so `onEscapeKeyDown` is suppressed and the caller's own keydown-capture
// handler (shared with Tab/Enter/arrow-key handling, which Radix has no opinion on anyway) owns it
// instead. Selecting an option uses `onMouseDown` + `preventDefault` rather than `onClick` alone, for
// the same reason: a plain click first fires a blur on the text field, which this can't allow.
export const ReferenceAutocompleteMenu = ({
  rect,
  options,
  highlighted,
  emptyText,
  onPick,
  onOpenChange,
}: {
  /** Viewport-relative — `caretCoordinates.ts`'s `caretRect` or ProseMirror's `coordsAtPos`, both
   * already in that space. `null` means nothing to anchor to yet (closed). */
  rect: { left: number; top: number; bottom: number } | null;
  options: ReferenceOption[];
  highlighted: number;
  emptyText: string;
  onPick: (id: string) => void;
  /** Only ever called with `false`, from Radix's own outside-click detection. */
  onOpenChange: (open: boolean) => void;
}) => {
  if (!rect) return null;
  return (
    <Popover.Root open onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            width: 1,
            height: Math.max(1, rect.bottom - rect.top),
            pointerEvents: "none",
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="z-50 max-h-56 w-72 max-w-[min(18rem,var(--radix-popover-content-available-width))] overflow-y-auto rounded-md border border-border bg-card/90 py-1 shadow-lg outline-none backdrop-blur-md"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{emptyText}</p>
          ) : (
            options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the text field, not on this button
                  onPick(o.id);
                }}
                className={cn(
                  "block w-full truncate px-3 py-1.5 text-left text-sm outline-none",
                  i === highlighted ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {o.label}
              </button>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

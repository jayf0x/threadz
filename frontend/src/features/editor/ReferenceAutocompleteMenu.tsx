import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export type ReferenceOption = { id: string; label: string };

// The reference autocomplete's dropdown — popover-shaped, so it's Radix (`@radix-ui/react-popover`,
// the same primitive the note popover uses), not hand-rolled. It's a different anchoring problem
// than an icon-triggered popover though: there's no DOM element sitting at "the caret," so
// `MarkdownEditor` measures that point itself (ProseMirror's `view.coordsAtPos`) and hands it in as
// `rect` — from there, Radix owns everything a popover normally owns: the portal, flip/shift to stay
// on screen (it opens below the caret and flips above when there's no room, e.g. the composer at the
// bottom of the screen), and outside-click dismissal (`onOpenChange`, wired by the caller straight to
// closing the autocomplete). Escape is deliberately NOT left to Radix: its default handling also tries
// to return focus to a trigger element, which doesn't exist here (focus must stay in the text field
// the whole time this is open) — so `onEscapeKeyDown` is suppressed and the caller's own keydown-capture
// handler (shared with Tab/Enter/arrow-key handling, which Radix has no opinion on anyway) owns it
// instead. Selecting an option uses `onMouseDown` + `preventDefault` rather than `onClick` alone, for
// the same reason: a plain click first fires a blur on the text field, which this can't allow.
export const ReferenceAutocompleteMenu = ({
  rect,
  options,
  highlighted,
  onPick,
  onOpenChange,
}: {
  /** Viewport-relative, ProseMirror's `coordsAtPos` — already in that space. `null` means nothing to
   * anchor to yet (closed). */
  rect: { left: number; top: number; bottom: number } | null;
  options: ReferenceOption[];
  highlighted: number;
  onPick: (id: string) => void;
  /** Only ever called with `false`, from Radix's own outside-click detection. */
  onOpenChange: (open: boolean) => void;
}) => {
  if (!rect) return null;
  const inset = keyboardInset();
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
          sideOffset={8}
          collisionPadding={{ top: 12 + inset.top, bottom: 12 + inset.bottom, left: 12, right: 12 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className={cn(
            "pop-in z-50 w-72 max-w-[min(20rem,var(--radix-popover-content-available-width))] overflow-y-auto rounded-2xl p-1.5",
            "max-h-[min(16.5rem,var(--radix-popover-content-available-height))]",
            "border border-border bg-card/95 shadow-lg ring-1 ring-border outline-none backdrop-blur-xl",
          )}
        >
          {options.length === 0 ? (
            <p className="flex h-11 items-center px-3 text-sm text-muted-foreground">No match</p>
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
                  "flex h-11 w-full items-center rounded-xl px-3 text-left text-base outline-none press-row md:text-sm",
                  i === highlighted ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="truncate">{o.label}</span>
              </button>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

// iOS overlays the keyboard on the layout viewport, and Radix measures collisions against that one, so
// without this the popup would open "below" the caret, under the keyboard. Padding the boundary by
// what the keyboard (and a panned visual viewport) covers makes it flip above instead.
const keyboardInset = () => {
  const vv = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!vv) return { top: 0, bottom: 0 };
  return { top: vv.offsetTop, bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop) };
};

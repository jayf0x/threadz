import { cn } from "@/lib/cn";
import { openPanel, total, useStatus } from "@/lib/status";

// Three honest states, told apart by SHAPE as well as colour (the tooltip adds whether main is reachable):
//   ● Live      — filled ochre disc: reading/writing main
//   ○ Offline   — hollow disc: live mode, main unreachable (drafts queue)
//   ■ Local     — filled ink square: this device is the source of truth
// A count of changes not yet on main (`n↑`) follows the label when there are any.
export const StatusPill = () => {
  const s = useStatus();
  const local = s.mode === "local";
  const up = s.checked ? s.reachable : true; // don't flash "Offline" before the first probe
  const pending = total(s.unsynced);
  const label = local ? "Local" : up ? "Live" : "Offline";
  const hint = local
    ? up
      ? "Working locally. Reachable — open to sync."
      : "Working locally. No connection."
    : up
      ? "Live. Open to work locally."
      : "Unreachable. Open for options.";

  return (
    <button
      type="button"
      onClick={openPanel}
      title={hint}
      className={cn(
        "press flex h-11 items-center gap-2.5 rounded-full bg-muted px-4 text-sm font-medium text-foreground md:h-9",
        "shadow-[inset_0_0_0_1px_var(--border)] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2.5 shrink-0 border",
          local
            ? "border-foreground bg-foreground"
            : up
              ? "rounded-full border-primary bg-primary"
              : "rounded-full border-muted-foreground",
        )}
      />
      {label}
      {pending > 0 && (
        <span className="tabular-nums text-muted-foreground">
          {pending}↑<span className="sr-only"> changes not yet synced</span>
        </span>
      )}
    </button>
  );
};

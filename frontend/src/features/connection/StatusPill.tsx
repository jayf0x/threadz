import { cn } from "@/lib/cn";
import { openPanel, total, useStatus } from "@/lib/status";

// Four honest states, told apart by SHAPE as well as colour:
//   ● Live      — filled ochre disc: reading/writing main
//   ○ Offline   — hollow disc: live mode, main unreachable (drafts queue)
//   ■ Local     — filled ink square: this device is the source of truth
//   ■ Local ↑   — same, with a ping: main is reachable, a sync is available
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
      className="group -my-3 flex items-center gap-2 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="relative flex size-2 items-center justify-center">
        <span
          className={cn(
            "relative size-2 border",
            local
              ? "border-foreground bg-foreground"
              : up
                ? "rounded-full border-primary bg-primary"
                : "rounded-full border-muted-foreground",
          )}
        />
      </span>
      {label}
      {pending > 0 && (
        <span className="text-primary">
          {pending}↑<span className="sr-only"> changes not yet synced</span>
        </span>
      )}
    </button>
  );
};

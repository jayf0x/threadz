import { cn } from "@/lib/cn";
import { openPanel, useSyncStatus } from "@/lib/syncEngine";

// Four states, told apart by shape as well as colour (docs/direction.md "B9" — replaces v1's
// Live/Offline/Local trio, since there's no "local" mode any more: the phone always reads/writes its
// own database):
//   ● Synced      — filled ochre disc: nothing pending, keep-live off
//   ◐ Keep-live   — half-filled disc: the 15s auto-sync loop is on
//   ○ N pending   — hollow disc with a count: work saved here, not yet sent
//   ■ Unreachable — filled ink square: the last sync attempt failed
export const StatusPill = () => {
  const s = useSyncStatus();
  const label = s.unreachable ? "Unreachable" : s.keepLive ? "Keep-live" : s.pending ? "Pending" : "Synced";
  const hint = s.unreachable
    ? "Can't reach main. Open for options."
    : s.keepLive
      ? "Syncing automatically every 15s."
      : s.pending
        ? "Saved on this device. Open to sync."
        : "Everything is synced.";

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
          s.unreachable
            ? "border-foreground bg-foreground"
            : s.keepLive
              ? "rounded-full border-primary bg-primary/50"
              : s.pending
                ? "rounded-full border-muted-foreground"
                : "rounded-full border-primary bg-primary",
        )}
      />
      {label}
      {s.pending > 0 && (
        <span className="tabular-nums text-muted-foreground">
          {s.pending}↑<span className="sr-only"> changes not yet synced</span>
        </span>
      )}
    </button>
  );
};

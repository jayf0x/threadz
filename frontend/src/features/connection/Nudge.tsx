import { Button } from "@/components/ui/button";
import { dismissNudge, openPanel, total, useStatus } from "@/lib/status";
import { plural } from "./connectionCopy";

// Non-modal, so it never steals focus from a half-typed note. Appears once per
// "main came back"; Later leaves the pill pulsing instead.
export const Nudge = () => {
  const s = useStatus();
  if (s.panel || s.mode !== "local") return null;
  const pending = total(s.unsynced);
  if (!s.nudge && !s.detached) return null;
  return (
    <div
      role="status"
      className="rise fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center justify-between gap-3 border border-primary bg-card px-4 py-3 shadow-lg"
    >
      {s.nudge ? (
        <>
          <p className="text-sm">
            <span className="font-serif text-base">Main is reachable.</span>{" "}
            <span className="text-muted-foreground">
              {pending ? `${plural(pending, "change")} to sync.` : "Nothing to sync."}
            </span>
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" onClick={openPanel}>
              Review
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissNudge}>
              Later
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-serif text-base">Main went away.</span>{" "}
            <span className="text-muted-foreground">You're on this device's copy — nothing is lost.</span>
          </p>
          <Button size="sm" variant="ghost" onClick={dismissNudge}>
            OK
          </Button>
        </>
      )}
    </div>
  );
};

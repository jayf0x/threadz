import { RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { StatusPill } from "@/features/connection";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { manualSync, useSyncStatus } from "@/lib/syncEngine";
import { Section } from "./SettingsSection";

/** First section: where you stand (synced/pending/keep-live/unreachable) and a manual sync — the two
 * things that used to live in the sidebar footer. Tapping the pill opens `ConnectionDialog` for the
 * real actions (sync now, keep-live, export); this is deliberately just a status line, not a copy of it. */
export const SyncSection = () => {
  const s = useSyncStatus();

  return (
    <Section title="Sync">
      <div className="flex items-center justify-between">
        <StatusPill />
        <button
          type="button"
          onClick={() => manualSync().catch((e) => toast({ title: "Sync failed", description: errorMessage(e) }))}
          disabled={s.syncing}
          aria-label="Sync now"
          title="Sync now"
          className="press-icon grid size-11 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-9"
        >
          <RefreshCw aria-hidden className={cn("size-5 md:size-4", s.syncing && "animate-spin")} />
        </button>
      </div>
    </Section>
  );
};

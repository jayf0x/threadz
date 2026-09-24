import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/features/connection";
import { cn } from "@/lib/cn";
import { getMode } from "@/lib/mode";
import { pullThreads } from "@/lib/sync";
import { Section } from "./SettingsSection";

/** First section: where you stand (local/live/offline) and a manual sync — the two things that
 * used to live in the sidebar footer. Tapping the pill opens `ConnectionDialog` for the real
 * actions (go local, go live, backups); this is deliberately just a status line, not a copy of it. */
export const SyncSection = () => {
  const [syncing, setSyncing] = useState(false);

  return (
    <Section title="Sync">
      <div className="flex items-center justify-between">
        <StatusPill />
        {getMode() === "live" && (
          <button
            type="button"
            onClick={async () => {
              setSyncing(true);
              try {
                await pullThreads();
              } finally {
                setSyncing(false);
              }
            }}
            disabled={syncing}
            aria-label="Sync now"
            title="Sync now"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          </button>
        )}
      </div>
    </Section>
  );
};

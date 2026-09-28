import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveOverlay } from "@/components/ui/responsive-overlay";
import { MarkdownEditor } from "@/features/editor";
import { cn } from "@/lib/cn";
import { type PeekMessage, peekWindow, resolvePeekAnchor } from "@/lib/data";
import { GutterMarksRow } from "./GutterMarks";

// Peek (docs/direction.md "Lenses": "one linked entity plus its neighbours in its own thread → an
// overlay that can open further overlays"). Self-contained: it owns its own `open` state and its own
// data load, so a gutter mark just hands it an entity id and a trigger element. Each windowed message
// gets its own gutter-marks row (`GutterMarksRow`, the same component `EntryRow` uses), and every mark
// there is itself a `Peek` — that's the "further overlays" nesting: `ResponsiveOverlay`s stacking
// (Radix Popover/Dialog handle the layering), not a bespoke recursive data structure.
export const Peek = ({
  entityId,
  trigger,
  onOpenThread,
}: {
  entityId: string;
  trigger: ReactElement;
  /** "Open full thread" inside the peek — wired back to the same navigation `ThreadView` already uses. */
  onOpenThread?: (threadId: string, messageId: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [anchor, setAnchor] = useState<{ threadId: string; messageId: string } | null | undefined>(undefined);
  const [messages, setMessages] = useState<PeekMessage[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    resolvePeekAnchor(entityId).then(async (a) => {
      if (cancelled) return;
      setAnchor(a);
      setMessages(a ? await peekWindow(a.threadId, a.messageId) : []);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, entityId]);

  return (
    <ResponsiveOverlay open={open} onOpenChange={setOpen} anchor={trigger} title="Peek">
      {open && (
        <div className="flex flex-col gap-2">
          {loading && <p className="p-2 text-sm text-muted-foreground">Loading…</p>}
          {!loading && anchor === null && <p className="p-2 text-sm text-muted-foreground">Nothing to preview.</p>}
          {!loading &&
            anchor &&
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn("rounded-xl p-2", msg.id === anchor.messageId ? "bg-accent" : "opacity-70")}
              >
                {msg.role === "assistant" && (
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Claude</p>
                )}
                <MarkdownEditor readOnly value={msg.content} className="[--md-padding:0]" />
                <div className="mt-1">
                  <GutterMarksRow messageId={msg.id} onOpenThread={onOpenThread} />
                </div>
              </div>
            ))}
          {!loading && anchor && onOpenThread && (
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => {
                onOpenThread(anchor.threadId, anchor.messageId);
                setOpen(false);
              }}
            >
              Open thread
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      )}
    </ResponsiveOverlay>
  );
};

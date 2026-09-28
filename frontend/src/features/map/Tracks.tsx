import { useVirtualizer } from "@tanstack/react-virtual";
import type { MapCell, MapTracks } from "@threadz/core";
import { Circle, CircleCheck } from "lucide-react";
import { useRef } from "react";
import { Peek } from "@/features/threads";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/useMedia";

// Tracks layout: one row per thread, its messages left to right as compact cells, and a note that sits in
// several threads drawn as a connector through its cells. The rows are virtualized and measured
// (AGENTS.md "measure, don't guess"); the connectors are an SVG laid over the same scroll content, reading
// each row's real offset from the virtualizer so they follow the measured heights.
const LABEL = 112;
const PAD = 8;
const GAP = 6;

const slotOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 8;
  return h + 1;
};

export const Tracks = ({
  tracks,
  onOpenThread,
}: {
  tracks: MapTracks;
  onOpenThread: (threadId: string, messageId: string) => void;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const wide = useMedia("(min-width: 768px)");
  const cell = wide ? 36 : 44;
  const { rows, connectors } = tracks;
  const shared = new Map<string, number>(); // noteId -> colour slot, for notes drawn as a connector
  for (const c of connectors) shared.set(c.noteId, slotOf(c.noteId));

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => cell + 12,
    overscan: 6,
    getItemKey: (i) => rows[i]?.threadId ?? i,
  });

  const widest = rows.reduce((n, r) => Math.max(n, r.cells.length), 0);
  const width = LABEL + PAD * 2 + widest * (cell + GAP);
  const x = (c: number) => LABEL + PAD + c * (cell + GAP) + cell / 2;
  const y = (r: number) => {
    const m = virtual.measurementsCache[r];
    return m ? m.start + m.size / 2 : 0;
  };

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto border-t border-rule" data-testid="map-scroller">
      <div className="relative" style={{ height: virtual.getTotalSize(), width, minWidth: "100%" }}>
        <svg
          aria-hidden
          className="pointer-events-none absolute left-0 top-0"
          width={width}
          height={virtual.getTotalSize()}
        >
          {connectors.map((c) => {
            const stops = c.stops;
            const first = stops[0];
            if (!first) return null;
            const d = stops
              .map((s, i) => {
                const px = x(s.cell);
                return i === 0
                  ? `M${px} ${y(s.row)}`
                  : `L${x(stops[i - 1]?.cell ?? s.cell)} ${y(s.row)} L${px} ${y(s.row)}`;
              })
              .join(" ");
            return (
              <path
                key={c.noteId}
                d={d}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                style={{ stroke: `var(--chip-${slotOf(c.noteId)})` }}
              >
                <title>{c.label}</title>
              </path>
            );
          })}
        </svg>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              ref={virtual.measureElement}
              data-index={item.index}
              className="absolute left-0 top-0 flex items-center py-1.5"
              style={{ transform: `translateY(${item.start}px)`, width }}
            >
              <div
                className="sticky left-0 z-20 truncate bg-background pl-3 pr-2 font-serif text-sm"
                style={{ width: LABEL }}
                title={row.title}
              >
                {row.title}
              </div>
              <ul className="relative z-10 flex" style={{ gap: GAP, marginLeft: PAD }}>
                {row.cells.map((c) => (
                  <li key={c.messageId}>
                    <CellButton cell={c} size={cell} slot={shared.get(c.noteId)} onOpenThread={onOpenThread} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CellButton = ({
  cell,
  size,
  slot,
  onOpenThread,
}: {
  cell: MapCell;
  size: number;
  slot: number | undefined;
  onOpenThread: (threadId: string, messageId: string) => void;
}) => {
  const Todo = cell.todo === "done" ? CircleCheck : Circle;
  return (
    <Peek
      entityId={cell.messageId}
      onOpenThread={onOpenThread}
      trigger={
        <button
          type="button"
          title={cell.preview}
          aria-label={cell.preview || "Message"}
          className={cn(
            "press-icon grid place-items-center rounded-xl text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            slot ? "text-chip-foreground" : "bg-secondary text-secondary-foreground",
          )}
          style={{ width: size, height: size, backgroundColor: slot ? `var(--chip-${slot})` : undefined }}
        >
          {cell.todo ? (
            <Todo aria-hidden className="size-4" />
          ) : (
            <span aria-hidden>{cell.preview.charAt(0).toUpperCase()}</span>
          )}
        </button>
      }
    />
  );
};

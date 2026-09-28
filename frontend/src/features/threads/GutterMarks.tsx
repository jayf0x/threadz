import { ArrowDownLeft, ArrowUpRight, Layers, Square, SquareCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { onChange } from "@/lib/changeSignal";
import { type GutterMarks as GutterMarksData, gutterMarksFor, propertyValuesFor, todoStatusFor } from "@/lib/data";
import type { PropertyValue } from "@/lib/types";
import { Peek } from "./Peek";

const EMPTY: GutterMarksData = { otherThreads: [], links: [] };

// The gutter mark rail (docs/direction.md "Lenses", "Gutter": "per message: other threads its note is
// in, links in/out, values, todo — GitLens-style marks; off until wanted"). Every mark is a `Chip`
// (the frozen "one UI primitive for attached state"); an other-thread or link mark opens a `Peek` on
// the entity it points at, a value chip is read-only here (its editing surface is the message's own
// ⋯ menu / actions row), and the todo mark mirrors the actions row's Todo toggle without duplicating
// its click behaviour (toggling lives there, on the selected message only). Used both by `EntryRow`
// (gated on the gutter-marks setting) and by `Peek` itself, for its windowed messages.
export const GutterMarksRow = ({
  messageId,
  onOpenThread,
}: {
  messageId: string;
  onOpenThread?: (threadId: string, messageId: string) => void;
}) => {
  const [marks, setMarks] = useState<GutterMarksData>(EMPTY);
  const [values, setValues] = useState<PropertyValue[]>([]);
  const [todo, setTodo] = useState<{ done: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      gutterMarksFor(messageId).then(
        (m) => !cancelled && setMarks(m),
        () => {},
      );
      propertyValuesFor(messageId).then(
        (v) => !cancelled && setValues(v),
        () => {},
      );
      todoStatusFor(messageId).then(
        (t) => !cancelled && setTodo(t),
        () => {},
      );
    };
    load();
    const unsubscribe = onChange(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [messageId]);

  const empty = !marks.otherThreads.length && !marks.links.length && !values.length && !todo;
  if (empty) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {todo && (
        <Chip
          colorSlot={null}
          icon={todo.done ? SquareCheck : Square}
          label="Todo"
          title={todo.done ? "Todo (done)" : "Todo"}
        />
      )}
      {values.map((v) => (
        <Chip key={v.id} colorSlot={v.colorSlot} label={v.value ?? v.setName} title={v.setName} />
      ))}
      {marks.otherThreads.map((o) => (
        <Peek
          key={o.messageId}
          entityId={o.messageId}
          onOpenThread={onOpenThread}
          trigger={
            <Chip
              colorSlot={null}
              icon={Layers}
              label={o.threadTitle}
              title={`Also in ${o.threadTitle}`}
              onClick={() => {}}
            />
          }
        />
      ))}
      {marks.links.map((l) => (
        <Peek
          key={l.linkId}
          entityId={l.otherId}
          onOpenThread={onOpenThread}
          trigger={
            <Chip
              colorSlot={null}
              icon={l.direction === "out" ? ArrowUpRight : ArrowDownLeft}
              label={l.typeLabel ?? undefined}
              title={l.direction === "out" ? "Link out" : "Link in"}
              onClick={() => {}}
            />
          }
        />
      ))}
    </div>
  );
};

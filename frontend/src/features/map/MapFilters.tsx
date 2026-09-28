import type { MapFilter, MapFilterOptions } from "@threadz/core";
import { Check, Clock, Link2, ListTodo, Pin, SlidersHorizontal, Tag } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/input";
import { ResponsiveOverlay } from "@/components/ui/responsive-overlay";
import { Select } from "@/components/ui/select";
import { DAY } from "./presets";

// The filter controls: a row of removable chips for what is applied, and (rarely used, so behind one button)
// an overlay to change it. Every control edits the same `MapFilter` the URL carries.

const RANGES = [7, 30, 90];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SEP = "\u0000";

const rangeDays = (filter: MapFilter, now: number): string => {
  if (filter.from === undefined || filter.to !== undefined) return "";
  const days = Math.round((now - filter.from) / DAY);
  return RANGES.includes(days) ? String(days) : "";
};

export const ActiveChips = ({
  filter,
  options,
  onChange,
}: {
  filter: MapFilter;
  options: MapFilterOptions;
  onChange: (f: MapFilter) => void;
}) => {
  const drop = (...keys: (keyof MapFilter)[]) => {
    const next: MapFilter = { ...filter };
    for (const k of keys) delete next[k];
    onChange(next);
  };
  const prop = (set?: string, value?: string) => {
    const hit = options.properties.find((p) => p.setId === set && (value === undefined || p.value === value));
    return `${hit?.name ?? "Property"}${value ? `: ${value}` : ""}`;
  };
  const chips: { key: string; label: string; icon: typeof Clock; clear: (keyof MapFilter)[] }[] = [];
  if (filter.from !== undefined || filter.to !== undefined)
    chips.push({ key: "time", label: timeLabel(filter), icon: Clock, clear: ["from", "to"] });
  if (filter.weekday !== undefined)
    chips.push({ key: "weekday", label: WEEKDAYS[filter.weekday] ?? "Weekday", icon: Clock, clear: ["weekday"] });
  if (filter.hour !== undefined)
    chips.push({ key: "hour", label: `${String(filter.hour).padStart(2, "0")}:00 UTC`, icon: Clock, clear: ["hour"] });
  if (filter.setA !== undefined)
    chips.push({ key: "a", label: prop(filter.setA, filter.valueA), icon: Tag, clear: ["setA", "valueA"] });
  if (filter.setB !== undefined)
    chips.push({ key: "b", label: prop(filter.setB, filter.valueB), icon: Tag, clear: ["setB", "valueB"] });
  if (filter.linkedTo !== undefined) {
    const t = options.linkTargets.find((l) => l.id === filter.linkedTo);
    chips.push({ key: "link", label: t?.label ?? "Linked", icon: Link2, clear: ["linkedTo"] });
  }
  if (filter.pinned) chips.push({ key: "pin", label: "Stale pins", icon: Pin, clear: ["pinned"] });
  if (filter.todo)
    chips.push({
      key: "todo",
      label: filter.todo === "any" ? "Todos" : filter.todo === "open" ? "Open todos" : "Done todos",
      icon: ListTodo,
      clear: ["todo"],
    });
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-4 pb-2">
      {chips.map((c, i) => (
        <li key={c.key} className="min-w-0">
          <Chip
            colorSlot={(i % 8) + 1}
            icon={c.icon}
            label={c.label}
            title="Remove filter"
            aria-label={`Remove filter ${c.label}`}
            onClick={() => drop(...c.clear)}
          />
        </li>
      ))}
    </ul>
  );
};

const timeLabel = (f: MapFilter) => {
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (f.from !== undefined && f.to !== undefined) return `${fmt(f.from)} – ${fmt(f.to)}`;
  return f.from !== undefined ? `Since ${fmt(f.from)}` : `Until ${fmt(f.to ?? 0)}`;
};

export const FilterOverlay = ({
  filter,
  options,
  onChange,
  onSavePreset,
}: {
  filter: MapFilter;
  options: MapFilterOptions;
  onChange: (f: MapFilter) => void;
  onSavePreset: (name: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const now = Date.now();

  const patch = (p: Partial<MapFilter>) => {
    const next: MapFilter = { ...filter, ...p };
    for (const k of Object.keys(next) as (keyof MapFilter)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={setOpen}
      title="Filters"
      align="end"
      anchor={
        <Button size="icon" variant="outline" aria-label="Filters" title="Filters" className="shrink-0 rounded-full">
          <SlidersHorizontal aria-hidden className="size-5 md:size-4" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Property">
          <Select
            aria-label="Property"
            className="w-full"
            value={filter.setA === undefined ? "" : `${filter.setA}${SEP}${filter.valueA ?? ""}`}
            onChange={(e) => {
              const [setA, valueA] = e.target.value.split(SEP);
              patch(setA ? { setA, valueA: valueA ?? "" } : { setA: undefined, valueA: undefined });
            }}
          >
            <option value="">Any</option>
            {options.properties.map((p) => (
              <option key={`${p.setId}${SEP}${p.value}`} value={`${p.setId}${SEP}${p.value}`}>
                {p.value ? `${p.name}: ${p.value}` : p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Linked to">
          <Select
            aria-label="Linked to"
            className="w-full"
            value={filter.linkedTo ?? ""}
            onChange={(e) => patch({ linkedTo: e.target.value || undefined })}
          >
            <option value="">Anything</option>
            {options.linkTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Todo">
          <Select
            aria-label="Todo"
            className="w-full"
            value={filter.todo ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patch({ todo: v === "open" || v === "done" || v === "any" ? v : undefined });
            }}
          >
            <option value="">Any message</option>
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="any">Any todo</option>
          </Select>
        </Field>
        <Field label="Time">
          <Select
            aria-label="Time"
            className="w-full"
            value={rangeDays(filter, now)}
            onChange={(e) => {
              const days = Number(e.target.value);
              patch({ from: days ? now - days * DAY : undefined, to: undefined });
            }}
          >
            <option value="">{filter.from !== undefined || filter.to !== undefined ? "Custom" : "Any time"}</option>
            {RANGES.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        </Field>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            onSavePreset(n);
            setName("");
            setOpen(false);
          }}
        >
          <Input
            aria-label="Preset name"
            placeholder="Save as preset"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            aria-label="Save preset"
            title="Save preset"
            disabled={!name.trim()}
          >
            <Check aria-hidden className="size-5 md:size-4" />
          </Button>
        </form>
      </div>
    </ResponsiveOverlay>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
    {children}
  </div>
);

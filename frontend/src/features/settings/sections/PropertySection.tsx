import { BUILTIN, type ValueType } from "@threadz/core";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { onChange } from "@/lib/changeSignal";
import { createPropertySet, deletePropertySet, listPropertySets, renamePropertySet } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import type { PropertySet } from "@/lib/types";
import { Section } from "./SettingsSection";

const VALUE_TYPES: { value: ValueType; label: string }[] = [
  { value: "none", label: "None (a marker)" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];

const BUILTIN_IDS: readonly string[] = Object.values(BUILTIN);

// Manage global property sets (docs/direction.md "Round 6": "sets are managed from a Settings
// section"). Thread-scoped sets are created from context, not here — this list only ever shows
// `scopeThreadId === null` sets, and built-ins (attached/copied-from/source/local-only) are excluded:
// they're wired by other features, not something the user renames or deletes.
export const PropertySection = () => {
  const [sets, setSets] = useState<PropertySet[]>([]);
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState<ValueType>("none");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      listPropertySets().then(
        (rows) => setSets(rows.filter((s) => s.scopeThreadId === null && !BUILTIN_IDS.includes(s.id))),
        (e) => setError(errorMessage(e)),
      ),
    [],
  );

  useEffect(() => {
    load();
    return onChange(load);
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createPropertySet(trimmed, valueType);
      setName("");
      setValueType("none");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const startRename = (s: PropertySet) => {
    setRenamingId(s.id);
    setRenameDraft(s.name);
  };
  const commitRename = async (id: string) => {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await renamePropertySet(id, trimmed);
    } catch (err) {
      toast({ title: "Rename failed", description: errorMessage(err) });
    }
  };

  // Non-destructive underneath (entities tombstone, never hard-delete): delete right away, no
  // confirm() gate, same pattern as ThreadRow.tsx's own delete — its values simply go inert.
  const del = async (s: PropertySet) => {
    try {
      await deletePropertySet(s.id);
      toast({ title: "Property set deleted", description: s.name });
    } catch (err) {
      toast({ title: "Delete failed", description: errorMessage(err) });
    }
  };

  return (
    <Section title="Property sets">
      <ul className="flex flex-col gap-1">
        {sets.map((s) => (
          <li key={s.id} className="flex min-h-11 items-center gap-2">
            {renamingId === s.id ? (
              <form
                className="flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  commitRename(s.id);
                }}
              >
                <Input
                  autoFocus
                  aria-label="Property set name"
                  value={renameDraft}
                  maxLength={80}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                />
              </form>
            ) : (
              <>
                <Chip colorSlot={s.colorSlot} label={s.name} />
                <span className="text-xs text-muted-foreground">
                  {VALUE_TYPES.find((t) => t.value === s.valueType)?.label}
                </span>
              </>
            )}
            <div className="ml-auto">
              <Menu
                align="end"
                trigger={
                  <Button size="icon" variant="ghost" aria-label={`${s.name} actions`} title="Property set actions">
                    <MoreHorizontal className="size-5 md:size-4" />
                  </Button>
                }
                items={[
                  { label: "Rename", icon: Pencil, onClick: () => startRename(s) },
                  { label: "Delete", icon: Trash2, onClick: () => del(s), destructive: true },
                ]}
              />
            </div>
          </li>
        ))}
        {sets.length === 0 && <li className="py-1 text-sm text-muted-foreground">No property sets yet.</li>}
      </ul>

      <form className="mt-3 flex items-center gap-2 border-t border-rule pt-3" onSubmit={add}>
        <Input
          aria-label="New property set name"
          placeholder="New property set"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Select
          aria-label="Value type"
          value={valueType}
          onChange={(e) => setValueType(e.target.value as ValueType)}
          className="w-auto"
        >
          {VALUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Button size="icon" type="submit" aria-label="Add property set" title="Add" disabled={!name.trim() || creating}>
          <Plus className="size-5 md:size-4" />
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Section>
  );
};

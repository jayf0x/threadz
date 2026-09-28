import { BUILTIN, type ValueType } from "@threadz/core";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listPropertySets, setPropertyValue } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import type { PropertySet } from "@/lib/types";

const BUILTIN_IDS: readonly string[] = Object.values(BUILTIN);

const INPUT_TYPE: Record<ValueType, string> = { none: "text", text: "text", number: "number", date: "date" };
const PLACEHOLDER: Record<ValueType, string> = { none: "", text: "Value", number: "Number", date: "YYYY-MM-DD" };

// The message (or any entity's) ⋯ menu's "Add property" flow (docs/direction.md "Round 6": "A value
// is added to any entity from that entity's ⋯ menu"): pick a property set — this entity's thread's
// scoped sets plus every global one, built-ins excluded (those are wired by their own features, not
// picked by hand) — then a value if the set's type calls for one.
export const AddPropertyPanel = ({
  threadId,
  targetId,
  onDone,
}: {
  threadId: string;
  targetId: string;
  onDone: () => void;
}) => {
  const [sets, setSets] = useState<PropertySet[]>([]);
  const [setId, setSetId] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPropertySets(threadId).then(
      (rows) => {
        const available = rows.filter((s) => !BUILTIN_IDS.includes(s.id));
        setSets(available);
        setSetId((prev) => prev || available[0]?.id || "");
      },
      (e) => setError(errorMessage(e)),
    );
  }, [threadId]);

  const selected = sets.find((s) => s.id === setId);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!setId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setPropertyValue(setId, targetId, selected?.valueType === "none" ? null : value.trim() || null);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (sets.length === 0)
    return <p className="p-2 text-sm text-muted-foreground">No property sets yet — add one in Settings.</p>;

  return (
    <form className="flex flex-col gap-3 p-1" onSubmit={save}>
      <Select aria-label="Property set" value={setId} onChange={(e) => setSetId(e.target.value)}>
        {sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      {selected && selected.valueType !== "none" && (
        <Input
          aria-label="Value"
          placeholder={PLACEHOLDER[selected.valueType]}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type={INPUT_TYPE[selected.valueType]}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" disabled={saving || !setId}>
        Add
      </Button>
    </form>
  );
};

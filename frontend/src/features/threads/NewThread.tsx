import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { pullThreads } from "@/lib/sync";

export const NewThread = ({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) => {
  const [title, setTitle] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const thread = await api.createThread({ title: title.trim(), seed: seed.trim() || undefined });
      await pullThreads();
      onCreated(thread.id);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rise flex flex-col gap-3 border-t border-rule bg-card px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <Field
        label="Title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={error ?? undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seed" className="text-sm font-medium">
          Seed <span className="font-normal text-muted-foreground">— optional notes to start from</span>
        </label>
        <Textarea id="seed" className="h-24" value={seed} onChange={(e) => setSeed(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy || !title.trim()}>
        {busy ? "Creating…" : "Create thread"}
      </Button>
    </form>
  );
};

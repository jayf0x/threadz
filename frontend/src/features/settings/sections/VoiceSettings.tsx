import { useSyncExternalStore } from "react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { getSnapshot, setLanguage, setModel, subscribe } from "@/lib/voice/engine";
import { findModel, LANGUAGES, MODELS } from "@/lib/voice/models";

// Picking a model is also how you download it: it becomes the active model and loads
// (fetching once, then cached by the browser for offline use). The list lives in
// lib/voice/models.ts — a new model or language is one row there.
export const VoiceSettings = () => {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const active = findModel(s.prefs.model);

  const badge = (id: string, mb: number) => {
    if (id === s.model.id && s.model.status === "loading")
      return s.downloaded.includes(id) ? "loading…" : `${s.model.pct}%`;
    if (id === s.model.id && s.model.status === "error") return "retry";
    if (id === s.model.id && s.model.status === "ready") return "ready";
    return s.downloaded.includes(id) ? "downloaded" : `~${mb} MB`;
  };

  return (
    <div>
      <fieldset className="-mx-2 grid gap-0.5">
        <legend className="sr-only">Speech model</legend>
        {MODELS.map((m) => {
          const selected = m.id === s.prefs.model;
          return (
            <label
              key={m.id}
              className={cn(
                "press-row flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm md:min-h-9",
                "hover:bg-accent has-focus-visible:outline has-focus-visible:outline-ring",
                selected && "bg-accent",
              )}
            >
              <input
                type="radio"
                name="voice-model"
                className="size-5 shrink-0 accent-primary md:size-4"
                checked={selected}
                onChange={() => setModel(m.id)}
                onClick={() => selected && s.model.status === "error" && setModel(m.id)}
              />
              <span className="font-medium">{m.label}</span>
              <span className="truncate text-xs text-muted-foreground">{m.note}</span>
              <span
                className={cn(
                  "ml-auto shrink-0 text-xs tabular-nums text-muted-foreground",
                  selected && s.model.status === "error" && "text-destructive",
                )}
              >
                {badge(m.id, m.mb)}
              </span>
            </label>
          );
        })}
      </fieldset>

      {active.multilingual && (
        // biome-ignore lint/a11y/noLabelWithoutControl: wraps the native <select> inside our Select component
        <label className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Language</span>
          <Select value={s.prefs.language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </label>
      )}
    </div>
  );
};

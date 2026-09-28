import { isMapFilterEmpty, type MapFilter, mapFilterToSearch, parseMapFilter } from "@threadz/core";
import { ArrowLeft, Bookmark, Map as MapIcon, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Menu } from "@/components/ui/menu";
import { IconSelect } from "@/components/ui/select";
import { shortcutBlocked } from "@/lib/dom";
import { deleteMapPreset, saveMapPreset, useMapPresets } from "@/lib/mapPresets";
import { ActiveChips, FilterOverlay } from "./MapFilters";
import { builtinPresets } from "./presets";
import { mapUrl } from "./route";
import { Tracks } from "./Tracks";
import { useMapData } from "./useMapData";

// The Map screen (docs/direction.md "Lenses": "any of the above, filtered → the central computed overview"),
// tracks layout. Its filter lives in the URL (`/map?...`, the shape a Home insight links to) and is written
// back with replaceState, so a reload or a shared link lands on the same view. Presets are device-only.
export const MapView = ({
  search,
  onBack,
  onOpenThread,
}: {
  /** The `location.search` the map was opened with. */
  search: string;
  onBack: () => void;
  onOpenThread: (threadId: string, messageId: string) => void;
}) => {
  const [filter, setFilterRaw] = useState<MapFilter>(() => parseMapFilter(search));
  const [presetId, setPresetId] = useState("");
  const saved = useMapPresets();
  const builtin = useMemo(() => builtinPresets(Date.now()), []);
  const { tracks, options } = useMapData(filter);

  const setFilter = (next: MapFilter, preset = "") => {
    setFilterRaw(next);
    setPresetId(preset);
    history.replaceState(null, "", mapUrl(mapFilterToSearch(next)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !shortcutBlocked(e)) onBack();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onBack]);

  const choose = (id: string) => {
    if (!id) return setFilter({});
    const b = builtin.find((p) => p.id === id);
    if (b) return setFilter(b.filter, id);
    const s = saved.find((p) => p.id === id);
    if (s) setFilter(parseMapFilter(s.search), id);
  };

  const menuItems = [
    { label: "Reset filters", icon: RotateCcw, onClick: () => setFilter({}) },
    ...(saved.some((p) => p.id === presetId)
      ? [
          {
            label: "Delete preset",
            icon: Trash2,
            destructive: true,
            onClick: () => {
              deleteMapPreset(presetId);
              setPresetId("");
            },
          },
        ]
      : []),
  ];

  const rows = tracks?.rows.length ?? 0;
  return (
    <div className="surface-background flex h-full flex-col">
      <header className="px-2 pb-3 pt-6 md:px-5">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Back" className="shrink-0" onClick={onBack}>
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="min-w-0 flex-1 pl-1 font-serif text-[32px] leading-none tracking-tight">Map</h1>
          <IconSelect
            icon={Bookmark}
            aria-label="Presets"
            title="Presets"
            value={presetId}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">All threads</option>
            {builtin.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {saved.length > 0 && (
              <optgroup label="Saved">
                {saved.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </IconSelect>
          <FilterOverlay
            filter={filter}
            options={options}
            onChange={setFilter}
            onSavePreset={(name) => setPresetId(saveMapPreset(name, mapFilterToSearch(filter)).id)}
          />
          <Menu
            align="end"
            items={menuItems}
            trigger={
              <Button size="icon" variant="ghost" aria-label="More" title="More" className="shrink-0">
                <MoreHorizontal aria-hidden className="size-5 md:size-4" />
              </Button>
            }
          />
        </div>
        <Eyebrow className="mt-2 pl-3">
          {tracks === null
            ? "Reading…"
            : `${rows} thread${rows === 1 ? "" : "s"}${isMapFilterEmpty(filter) ? "" : " · filtered"}`}
        </Eyebrow>
      </header>
      <ActiveChips filter={filter} options={options} onChange={setFilter} />
      {tracks?.rows.length === 0 ? (
        <Empty icon={MapIcon}>Nothing matches</Empty>
      ) : (
        tracks && <Tracks tracks={tracks} onOpenThread={onOpenThread} />
      )}
    </div>
  );
};

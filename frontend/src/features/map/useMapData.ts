import type { MapFilter, MapFilterOptions, MapTracks } from "@threadz/core";
import { useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { loadMapFilterOptions, loadMapTracks } from "@/lib/data";

const NO_OPTIONS: MapFilterOptions = { properties: [], linkTargets: [] };

// The map's two reads: tracks for the current filter (null while loading), and what the filter controls can
// offer. Both re-read on any local write or sync.
export const useMapData = (filter: MapFilter) => {
  const [tracks, setTracks] = useState<MapTracks | null>(null);
  const [options, setOptions] = useState<MapFilterOptions>(NO_OPTIONS);
  const key = JSON.stringify(filter);

  useEffect(() => {
    let live = true;
    const load = () => {
      loadMapTracks(JSON.parse(key)).then(
        (t) => live && setTracks(t),
        () => live && setTracks({ rows: [], connectors: [] }),
      );
      loadMapFilterOptions().then(
        (o) => live && setOptions(o),
        () => {},
      );
    };
    load();
    const off = onChange(load);
    return () => {
      live = false;
      off();
    };
  }, [key]);

  return { tracks, options };
};

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { useEffect, useState } from "react";

// The device's chosen wallpaper (or GIF) — one row, no history: picking a new one replaces it
// outright. Lives in its own IndexedDB, same reasoning as lib/images.ts's note photos: bytes never
// belong in localStorage (5-10MB quota, and lib/settings.ts's whole store gets re-stringified on
// every write) and never in a snapshot/backup — this is decorative and per-device, nothing else
// depends on it existing.

const MAX_BYTES = 15 * 1024 * 1024; // generous for a GIF; a hard stop against a picked RAW/video file

interface BackgroundDB extends DBSchema {
  blobs: { key: string; value: Blob };
}

let dbp: Promise<IDBPDatabase<BackgroundDB>> | null = null;
const getDB = () => {
  dbp ??= openDB<BackgroundDB>("threadz-background", 1, {
    upgrade: (db) => void db.createObjectStore("blobs"),
  });
  return dbp;
};

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const setBackgroundImage = async (file: File) => {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image or GIF file.");
  if (file.size > MAX_BYTES) throw new Error("That file is too large (15 MB max).");
  await (await getDB()).put("blobs", file, "current");
  emit();
};

export const clearBackgroundImage = async () => {
  await (await getDB()).delete("blobs", "current");
  emit();
};

export const getBackgroundImageBlob = () => getDB().then((db) => db.get("blobs", "current"));

/** The current background image as an object URL, or null while there isn't one (or `enabled` is
 * false). IndexedDB has no live-query, so — like lib/settings.ts's own listeners — this only ever
 * picks up a change made in this tab; another tab's pick is seen next time this one reloads. */
export const useBackgroundImageUrl = (enabled: boolean): string | null => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    let current: string | null = null;
    const load = async () => {
      const blob = await getBackgroundImageBlob();
      if (current) URL.revokeObjectURL(current);
      current = blob ? URL.createObjectURL(blob) : null;
      setUrl(current);
    };
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
      if (current) URL.revokeObjectURL(current);
    };
  }, [enabled]);

  return url;
};

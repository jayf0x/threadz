// The phone's own SQLite (docs/direction.md "Device storage and export" + "A. Foundation"): opens
// @subframe7536/sqlite-wasm's IndexedDB-backed async db inside a dedicated Web Worker
// (phone/worker.ts) — the wasm and the real db handle never leave that worker, so the main bundle never
// pays for them (same reasoning AGENTS.md gives for keeping Milkdown/ProseMirror out of static imports).
// This module is the thin async proxy other code drives: `core`'s `Driver` (run/all/tx) implemented as
// postMessage round-trips, correlated by phone/broker.ts.
//
// Not wired into any UI or existing sync code yet — that's D4 (sync v2). A caller here owns the
// `PhoneDb` it opens and its worker's lifetime.
import type { Driver } from "@threadz/core";
import { createBroker } from "./phone/broker";
import { createPhoneDriver } from "./phone/driver";

export type PhoneDb = {
  driver: Driver;
  // Raw database bytes (`db.dump()` under the hood) — a real `.sqlite` file, openable by the `sqlite3`
  // CLI or any SQLite tool.
  dump: () => Promise<Uint8Array>;
  // Same bytes as `dump()`, offered as a browser download.
  exportFile: (filename?: string) => Promise<void>;
  // Merges another `.sqlite` file's rows into this db via core's `applyChanges` (insert-if-missing /
  // last-write-wins) — never a wholesale replace.
  importFile: (file: File) => Promise<{ imported: number }>;
  close: () => Promise<void>;
};

export const DEFAULT_NAME = "threadz-phone.sqlite";

/** `open` failed. `rawDump` is the file's bytes when they were still readable. */
export class PhoneOpenError extends Error {
  constructor(
    message: string,
    public rawDump?: Uint8Array,
  ) {
    super(message);
  }
}

export const openPhoneDb = async (name = DEFAULT_NAME): Promise<PhoneDb> => {
  const worker = new Worker(new URL("./phone/worker.ts", import.meta.url), { type: "module" });
  const broker = createBroker((req, transfer) => worker.postMessage(req, transfer));
  worker.onmessage = (e: MessageEvent) => broker.receive(e.data);
  worker.onerror = (e) => {
    e.preventDefault();
    broker.rejectAll(new Error(e.message || "Phone db worker crashed"));
  };

  try {
    await broker.send({ type: "open", name });
  } catch (e) {
    // Surface the reason, plus whatever bytes are still readable (the file opened but the schema step
    // failed, e.g. "newer than this app"); a failure before the file opened has none, so no export offered.
    const rawDump = await broker
      .send({ type: "dump" })
      .then((b) => b as Uint8Array)
      .catch(() => undefined);
    worker.terminate();
    throw new PhoneOpenError(e instanceof Error ? e.message : String(e), rawDump);
  }

  const driver: Driver = createPhoneDriver(broker);

  return {
    driver,
    dump: async () => (await broker.send({ type: "dump" })) as Uint8Array,
    exportFile: async (filename = `threadz-phone-${stamp()}.sqlite`) => {
      const bytes = (await broker.send({ type: "dump" })) as Uint8Array;
      downloadBytes(bytes, filename);
    },
    importFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return (await broker.send({ type: "importBytes", bytes }, [bytes.buffer])) as { imported: number };
    },
    close: async () => {
      await broker.send({ type: "close" });
      worker.terminate();
    },
  };
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// Same browser-download idiom as handoff.ts's `download` (create an object URL, click a throwaway
// anchor, revoke it after a beat) — not reused directly since that helper is typed for text content
// (`File([content], ...)` with `content: string`) and touching it is out of scope for this module.
export const downloadBytes = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([bytes], { type: "application/vnd.sqlite3" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

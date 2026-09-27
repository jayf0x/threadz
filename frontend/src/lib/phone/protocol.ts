// Message shapes for the postMessage protocol between the main thread (phoneDb.ts) and the dedicated
// worker that holds the phone's real SQLite handle (worker.ts). Kept in its own file so both sides — and
// broker.ts's tests — import the same types without either side importing the other.
import type { Param } from "@threadz/core";

export type PhoneRequest =
  | { id: number; type: "open"; name: string }
  | { id: number; type: "run"; sql: string; params: Param[] }
  | { id: number; type: "all"; sql: string; params: Param[] }
  | { id: number; type: "dump" }
  | { id: number; type: "importBytes"; bytes: Uint8Array }
  | { id: number; type: "close" };

export type PhoneResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

// `Omit<PhoneRequest, "id">` alone collapses the union to its common keys (a well-known TS gotcha), which
// would let a caller send e.g. `{ type: "run", bytes: ... }` and still typecheck. This distributes over
// each member first, so the discriminated union shape survives.
export type PhoneRequestBody<T extends PhoneRequest = PhoneRequest> = T extends unknown ? Omit<T, "id"> : never;

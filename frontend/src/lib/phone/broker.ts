// Correlates requests sent to the phone worker with their replies by an incrementing request id — the
// pure message-passing half of the worker-proxy Driver, deliberately split out from worker wiring (a
// real `postMessage`/`onmessage`) so it's unit-testable without a real Worker (bun test's runtime may not
// support one the way a browser does; see phoneDb.test.ts).
import type { PhoneRequest, PhoneRequestBody, PhoneResponse } from "./protocol";

export type Broker = {
  // Sends one request (an id is assigned and stamped on it) and resolves/rejects when its matching reply
  // arrives via `receive`. `transfer` is passed straight through to `post` for a transferable payload
  // (e.g. the bytes of an imported .sqlite file).
  send: (req: PhoneRequestBody, transfer?: Transferable[]) => Promise<unknown>;
  // Feed one reply in — call this from the worker's `onmessage`.
  receive: (res: PhoneResponse) => void;
  // Reject every still-pending request (the worker died, or the caller is tearing down) so nothing hangs.
  rejectAll: (error: Error) => void;
};

export const createBroker = (post: (req: PhoneRequest, transfer: Transferable[]) => void): Broker => {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  return {
    send: (req, transfer = []) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ ...req, id } as PhoneRequest, transfer);
      }),
    receive: (res) => {
      const p = pending.get(res.id);
      if (!p) return; // a reply for a request we're no longer tracking (already rejected, e.g.) — ignore
      pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error));
    },
    rejectAll: (error) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
    },
  };
};

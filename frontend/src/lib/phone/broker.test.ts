import { expect, test } from "bun:test";
import { createBroker } from "./broker";
import type { PhoneRequest } from "./protocol";

test("assigns a fresh, incrementing id per send and stamps it on the outgoing request", () => {
  const sent: PhoneRequest[] = [];
  const broker = createBroker((req) => sent.push(req));

  void broker.send({ type: "run", sql: "a", params: [] });
  void broker.send({ type: "run", sql: "b", params: [] });
  void broker.send({ type: "run", sql: "c", params: [] });

  expect(sent.map((r) => r.id)).toEqual([1, 2, 3]);
});

test("resolves the matching promise when a reply with its id arrives, even out of order", async () => {
  const sent: PhoneRequest[] = [];
  const broker = createBroker((req) => sent.push(req));

  const first = broker.send({ type: "all", sql: "select 1", params: [] });
  const second = broker.send({ type: "all", sql: "select 2", params: [] });

  // Reply to the second request before the first — a real worker can finish work out of arrival order.
  broker.receive({ id: sent[1]?.id as number, ok: true, result: ["two"] });
  broker.receive({ id: sent[0]?.id as number, ok: true, result: ["one"] });

  expect(await second).toEqual(["two"]);
  expect(await first).toEqual(["one"]);
});

test("rejects the matching promise on an error reply, without touching other pending requests", async () => {
  const sent: PhoneRequest[] = [];
  const broker = createBroker((req) => sent.push(req));

  const ok = broker.send({ type: "run", sql: "fine", params: [] });
  const bad = broker.send({ type: "run", sql: "boom", params: [] });

  broker.receive({ id: sent[1]?.id as number, ok: false, error: "syntax error" });
  broker.receive({ id: sent[0]?.id as number, ok: true, result: null });

  await expect(bad).rejects.toThrow("syntax error");
  await expect(ok).resolves.toBeNull();
});

test("a reply for an id that's no longer tracked is silently ignored, not thrown", () => {
  const broker = createBroker(() => {});
  expect(() => broker.receive({ id: 999, ok: true, result: "whatever" })).not.toThrow();
});

test("rejectAll settles every still-pending request and clears them, so a later reply for the same id is a no-op", async () => {
  const sent: PhoneRequest[] = [];
  const broker = createBroker((req) => sent.push(req));

  const p1 = broker.send({ type: "run", sql: "a", params: [] });
  const p2 = broker.send({ type: "run", sql: "b", params: [] });

  broker.rejectAll(new Error("worker crashed"));

  await expect(p1).rejects.toThrow("worker crashed");
  await expect(p2).rejects.toThrow("worker crashed");

  // A stray reply for the now-dropped request must not throw or resolve anything.
  expect(() => broker.receive({ id: sent[0]?.id as number, ok: true, result: "too late" })).not.toThrow();
});

test("passes the transfer list through to post untouched", () => {
  let capturedTransfer: Transferable[] | undefined;
  const broker = createBroker((_req, transfer) => {
    capturedTransfer = transfer;
  });
  const buf = new ArrayBuffer(4);
  void broker.send({ type: "importBytes", bytes: new Uint8Array(buf) }, [buf]);
  expect(capturedTransfer).toEqual([buf]);
});

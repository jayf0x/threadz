import { expect, test } from "bun:test";
import { createBroker } from "./broker";
import { createPhoneDriver } from "./driver";
import type { PhoneRequest } from "./protocol";

// A fake worker: replies to every request on the next microtask, `all` results always `[]` unless a test
// overrides `onRequest`. Enough to exercise the Driver's request shapes and tx sequencing without a real
// Worker or @subframe7536/sqlite-wasm — see AGENTS.md's "Tests" note on why phoneDb.ts's worker boundary
// itself is checked by ../../../scripts/verify-phone-db instead.
const fakeBroker = (onRequest?: (req: PhoneRequest) => unknown) => {
  const requests: PhoneRequest[] = [];
  const broker = createBroker((req) => {
    requests.push(req);
    queueMicrotask(() => broker.receive({ id: req.id, ok: true, result: onRequest?.(req) ?? [] }));
  });
  return { broker, requests };
};

test("run sends a 'run' request with the sql and params, ignoring the reply's value", async () => {
  const { broker, requests } = fakeBroker();
  const driver = createPhoneDriver(broker);

  await driver.run("INSERT INTO threads VALUES (?, ?)", ["t1", "Title"]);

  expect(requests).toEqual([{ id: 1, type: "run", sql: "INSERT INTO threads VALUES (?, ?)", params: ["t1", "Title"] }]);
});

test("run defaults params to an empty array when omitted", async () => {
  const { broker, requests } = fakeBroker();
  await createPhoneDriver(broker).run("DELETE FROM threads");
  expect(requests[0]).toMatchObject({ type: "run", params: [] });
});

test("all sends an 'all' request and resolves with the reply's rows", async () => {
  const rows = [{ id: "t1" }, { id: "t2" }];
  const { broker, requests } = fakeBroker((req) => (req.type === "all" ? rows : []));
  const driver = createPhoneDriver(broker);

  const result = await driver.all<{ id: string }>("SELECT id FROM threads");

  expect(requests[0]).toMatchObject({ type: "all", sql: "SELECT id FROM threads", params: [] });
  expect(result).toEqual(rows);
});

test("tx sends BEGIN then runs fn then COMMIT, in order, and returns fn's result", async () => {
  const { broker, requests } = fakeBroker();
  const driver = createPhoneDriver(broker);
  const order: string[] = [];

  const result = await driver.tx(async () => {
    order.push("fn");
    await driver.run("INSERT INTO threads VALUES (?)", ["t1"]);
    return 42;
  });

  expect(result).toBe(42);
  expect(requests.map((r) => (r.type === "run" ? r.sql : r.type))).toEqual([
    "BEGIN",
    "INSERT INTO threads VALUES (?)",
    "COMMIT",
  ]);
  expect(order).toEqual(["fn"]);
});

test("tx sends ROLLBACK instead of COMMIT and rethrows when fn throws", async () => {
  const { broker, requests } = fakeBroker();
  const driver = createPhoneDriver(broker);

  await expect(
    driver.tx(async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");

  expect(requests.map((r) => (r.type === "run" ? r.sql : r.type))).toEqual(["BEGIN", "ROLLBACK"]);
});

test("tx propagates a rejection from the BEGIN round-trip itself without ever calling fn", async () => {
  const broker = createBroker((req) => {
    queueMicrotask(() => broker.receive({ id: req.id, ok: false, error: "worker is gone" }));
  });
  const driver = createPhoneDriver(broker);
  let fnCalled = false;

  await expect(
    driver.tx(async () => {
      fnCalled = true;
    }),
  ).rejects.toThrow("worker is gone");
  expect(fnCalled).toBe(false);
});

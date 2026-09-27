// Builds core's `Driver` (run/all/tx) on top of a `Broker` — split out from phoneDb.ts so the tx
// sequencing (BEGIN → fn() → COMMIT, or ROLLBACK on failure) is testable against a fake broker, without a
// real Worker or @subframe7536/sqlite-wasm.
import type { Driver, Param } from "@threadz/core";
import type { Broker } from "./broker";

export const createPhoneDriver = (broker: Broker): Driver => {
  const driver: Driver = {
    run: async (sql, params: Param[] = []) => {
      await broker.send({ type: "run", sql, params });
    },
    all: async <T>(sql: string, params: Param[] = []) => (await broker.send({ type: "all", sql, params })) as T[],
    // Same shape as core/bun.ts's bunDriver.tx: fn() issues its own run/all calls (further round trips to
    // the worker), which stay in order because each is awaited before the next is sent.
    tx: async (fn) => {
      await driver.run("BEGIN");
      try {
        const result = await fn();
        await driver.run("COMMIT");
        return result;
      } catch (e) {
        await driver.run("ROLLBACK");
        throw e;
      }
    },
  };
  return driver;
};

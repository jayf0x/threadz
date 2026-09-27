import type { Database } from "bun:sqlite";
import type { Driver, Param } from "./schema";

// core's Driver over bun:sqlite (main, and every test). Kept out of index.ts so the frontend bundle never
// sees a bun import.
export const bunDriver = (db: Database): Driver => ({
  run: async (sql, params: Param[] = []) => void db.query(sql).run(...params),
  all: async <T>(sql: string, params: Param[] = []) => db.query(sql).all(...params) as T[],
  // bun:sqlite has no async transaction API, so this drives BEGIN/COMMIT/ROLLBACK by hand instead of
  // db.transaction() — the same shape the wa-sqlite driver needs anyway, since its VFS is genuinely async.
  tx: async (fn) => {
    db.query("BEGIN").run();
    try {
      const result = await fn();
      db.query("COMMIT").run();
      return result;
    } catch (e) {
      db.query("ROLLBACK").run();
      throw e;
    }
  },
});

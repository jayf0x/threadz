import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunDriver } from "./bun";
import { getSchemaVersion, migrate, SCHEMA_VERSION } from "./migrate";
import { SCHEMA } from "./schema";

const rawVersion = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;

test("a v1 file on disk migrates to the current version with its rows intact", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "threadz-migrate-")), "v1.sqlite");
  const old = new Database(path, { create: true });
  old.exec(SCHEMA);
  old.exec("INSERT INTO entities VALUES ('e1', 'thread', 1, 1, NULL, 5)");
  old.exec("INSERT INTO threads (id, title, updated_at, rev) VALUES ('e1', 'Kept', 1, 5)");
  old.exec("PRAGMA user_version = 1");
  old.close();

  const db = new Database(path);
  const d = bunDriver(db);
  await migrate(d);
  expect(rawVersion(db)).toBe(SCHEMA_VERSION);
  expect((await d.all<{ title: string }>("SELECT title FROM threads WHERE id = 'e1'"))[0]?.title).toBe("Kept");
  await migrate(d); // idempotent
  expect(await getSchemaVersion(d)).toBe(SCHEMA_VERSION);
  db.close();
});

test("a pre-versioning database (version 0, tables present) is stamped and a newer one is refused", async () => {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  expect(rawVersion(db)).toBe(0);
  const d = bunDriver(db);
  await migrate(d);
  expect(rawVersion(db)).toBe(SCHEMA_VERSION);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  await expect(migrate(d)).rejects.toThrow(/newer/);
});

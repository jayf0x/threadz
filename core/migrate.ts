import { applySchema, type Driver } from "./schema";

// Schema versioning on `PRAGMA user_version`. Same runner on main (bun:sqlite) and the phone (wa-sqlite worker),
// through core's Driver. Each step runs in its own transaction together with the version bump, so a crash
// leaves the database at the last completed step. A pre-versioning database (user_version 0, tables already
// there) needs no special case: step 1 is `CREATE IF NOT EXISTS` and stamps it 1.

export const SCHEMA_VERSION = 2;
// The wire format of /api/push + /api/changes. Bumped only when the request/response shape stops being compatible.
export const PROTOCOL_VERSION = 1;

type Step = (d: Driver) => Promise<void>;

// Index 0 is migration 1. Append only; never edit a shipped step.
const STEPS: Step[] = [
  applySchema,
  async () => {}, // 2: no-op, proves the runner
];

export const getSchemaVersion = async (d: Driver): Promise<number> => {
  const [row] = await d.all<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
};

// Brings any database (fresh, pre-versioning, or older) to SCHEMA_VERSION. A database from a *newer* app throws:
// never run old code over a schema it doesn't understand.
export const migrate = async (d: Driver): Promise<void> => {
  const from = await getSchemaVersion(d);
  if (from > SCHEMA_VERSION) throw new Error(`database schema v${from} is newer than this app (v${SCHEMA_VERSION})`);
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = STEPS[v - 1];
    if (!step) throw new Error(`missing migration ${v}`);
    await d.tx(async () => {
      await step(d);
      await d.run(`PRAGMA user_version = ${v}`);
    });
  }
};

export const initSchema = migrate;

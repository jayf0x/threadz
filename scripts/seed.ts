// `bun run seed [--scale small|real|large] [--out path] [--stamp]`: a deterministic, realistic .sqlite for
// perf and lens work. Rows are built in memory as a core `Changes` and written through `applyChanges`.
// A thin CLI over core/seed.ts (the generator): fixed seed and NOW, so two runs produce the same rows.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  applyChanges,
  type Changes,
  generateSeed,
  initSchema,
  SCALES,
  type Scale,
  SEED_NOW,
  stampRevs,
} from "@threadz/core";
import { bunDriver } from "@threadz/core/bun";

export const NOW = SEED_NOW;

export const generate = (scale: Scale): Changes =>
  generateSeed({ counts: SCALES[scale], seed: 0x7472_6561 + SCALES[scale].threads, now: NOW });

// --- output --------------------------------------------------------------------------------------------

export const writeSeed = async (path: string, scale: Scale, stamp = false) => {
  mkdirSync(dirname(path), { recursive: true });
  for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) rmSync(p);
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;");
  const d = bunDriver(db);
  await initSchema(d);
  const changes = generate(scale);
  await applyChanges(d, changes);
  if (stamp) await stampRevs(d);
  db.close();
  return changes;
};

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const scale = (opt("--scale") ?? "small") as Scale;
  if (!(scale in SCALES)) throw new Error(`--scale must be one of ${Object.keys(SCALES).join(", ")}`);
  const out = opt("--out") ?? `.seed/${scale}.sqlite`;
  const t0 = performance.now();
  const ch = await writeSeed(out, scale, args.includes("--stamp"));
  const counts = Object.entries(ch).map(([k, v]) => `${k} ${v.length}`);
  console.log(`${out} (${scale}, ${Math.round(performance.now() - t0)} ms)\n${counts.join(", ")}`);
}

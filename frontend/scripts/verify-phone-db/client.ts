// Headless verification client for phoneDb.ts (see run.ts). Not part of the app, its build, or `bun
// test` — this exercises the one part of phoneDb.ts/worker.ts that needs a real browser: a real Web
// Worker, real @subframe7536/sqlite-wasm, real IndexedDB. bun test covers the request/response
// correlation and tx sequencing logic against a fake worker (phone/broker.test.ts, phone/driver.test.ts);
// this instead proves the whole stack end to end, same spirit as ../spike-sqlite-wasm's worker.js.
import { openPhoneDb } from "@/lib/phoneDb";

declare global {
  interface Window {
    __verifyResult?: unknown;
    __verifyDone?: boolean;
  }
}

const report: { ok: boolean; steps: Array<{ name: string; ok: boolean; detail?: unknown; error?: string }> } = {
  ok: true,
  steps: [],
};

const step = async (name: string, fn: () => Promise<unknown>) => {
  try {
    const detail = await fn();
    report.steps.push({ name, ok: true, detail });
    return detail;
  } catch (e) {
    report.ok = false;
    report.steps.push({ name, ok: false, error: String(e) });
    throw e;
  }
};

async function main() {
  let a!: Awaited<ReturnType<typeof openPhoneDb>>;
  await step("open phone db A (opens a real worker, initSchema runs)", async () => {
    a = await openPhoneDb("verify-a.sqlite");
    const tables = await a.driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    return { tableCount: tables.length };
  });

  const now = Date.now();
  await step("write a thread on A directly through the Driver (run/all round-trip the worker)", () =>
    a.driver.tx(async () => {
      await a.driver.run("INSERT INTO entities VALUES (?,?,?,?,?,?)", ["t1", "thread", now, now, null, null]);
      await a.driver.run("INSERT INTO threads VALUES (?,?,?,?)", ["t1", "Kept on A", now, null]);
    }),
  );

  let bytesA!: Uint8Array;
  await step("dump A", async () => {
    bytesA = await a.dump();
    if (bytesA.length === 0) throw new Error("dump() returned no bytes");
    return { byteLength: bytesA.length };
  });

  let b!: Awaited<ReturnType<typeof openPhoneDb>>;
  await step("open phone db B (a second, independent worker + db)", async () => {
    b = await openPhoneDb("verify-b.sqlite");
  });

  const older = now - 1000;
  await step("seed B: an older edit to A's thread (last-write-wins should keep A's), plus a thread A doesn't have", () =>
    b.driver.tx(async () => {
      await b.driver.run("INSERT INTO entities VALUES (?,?,?,?,?,?)", ["t1", "thread", older, older, null, null]);
      await b.driver.run("INSERT INTO threads VALUES (?,?,?,?)", ["t1", "Stale on B", older, null]);
      await b.driver.run("INSERT INTO entities VALUES (?,?,?,?,?,?)", ["t2", "thread", now, now, null, null]);
      await b.driver.run("INSERT INTO threads VALUES (?,?,?,?)", ["t2", "Only on B", now, null]);
    }),
  );

  let bytesB!: Uint8Array;
  await step("dump B", async () => {
    bytesB = await b.dump();
    return { byteLength: bytesB.length };
  });

  const imported = await step("import B's exported file into A — must merge, not replace", async () => {
    const file = new File([bytesB], "b.sqlite");
    return a.importFile(file);
  });

  await step("A kept its own newer title for t1 (content wins) and gained t2 from B (union)", async () => {
    const rows = await a.driver.all<{ id: string; title: string }>("SELECT id, title FROM threads ORDER BY id");
    if (rows.length !== 2) throw new Error(`expected 2 threads after merge, got ${JSON.stringify(rows)}`);
    if (rows[0]?.title !== "Kept on A") throw new Error(`last-write-wins broke: ${JSON.stringify(rows)}`);
    if (rows[1]?.title !== "Only on B") throw new Error(`union broke, B's thread missing: ${JSON.stringify(rows)}`);
    return { rows, imported };
  });

  await step("close both dbs", async () => {
    await a.close();
    await b.close();
  });

  window.__verifyResult = { ...report, exportedByteLength: bytesA.length };
  window.__verifyDone = true;
}

main().catch(() => {
  window.__verifyResult = report;
  window.__verifyDone = true;
});

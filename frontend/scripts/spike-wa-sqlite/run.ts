// Throwaway spike runner for the v2 rebuild's Step A go/no-go check
// (docs/direction.md "A. Foundation" #1/#3/#4). Not part of the app, its
// build, or `bun test` — run manually with:
//
//   bun run frontend/scripts/spike-wa-sqlite/run.ts
//
// Launches headless Chromium at an iPhone-sized viewport (same pattern used
// elsewhere in this repo for headless mobile verification), loads a Web
// Worker that opens wa-sqlite's async build on IDBBatchAtomicVFS, creates an
// FTS5 trigram table, and exports the raw db bytes. This script then writes
// those bytes to disk and opens them with the `sqlite3` CLI to confirm the
// exported file is a real, readable SQLite database.
import { chromium, devices } from "playwright";
import { startSpikeServer } from "./server.ts";

const PORT = 8991;
const OUT_DB = "/tmp/threadz-spike-wa-sqlite-export.sqlite";

async function main() {
  const server = startSpikeServer(PORT);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[browser error] ${err}`));

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window as unknown as { __spikeDone?: boolean }).__spikeDone === true, {
      timeout: 30_000,
    });

    const report = await page.evaluate(() => (window as unknown as { __spikeResult: unknown }).__spikeResult);
    const bytesBase64 = await page.evaluate(
      () => (window as unknown as { __spikeBytesBase64: string | null }).__spikeBytesBase64,
    );

    console.log("\n=== wa-sqlite spike report ===");
    console.log(JSON.stringify(report, null, 2));

    // biome-ignore lint/suspicious/noExplicitAny: throwaway spike script, shape is whatever the worker posted
    const r = report as any;
    if (!r?.ok) {
      console.error("\nFAIL: one or more in-browser checks failed. Stopping — not proceeding to sqlite3 CLI check.");
      process.exit(1);
    }

    if (!bytesBase64) {
      console.error("\nFAIL: no exported bytes came back from the worker.");
      process.exit(1);
    }

    await Bun.write(OUT_DB, Buffer.from(bytesBase64, "base64"));
    console.log(`\nWrote exported db to ${OUT_DB}, opening with the sqlite3 CLI...`);

    const cli = Bun.spawnSync(["sqlite3", OUT_DB, ".tables", "SELECT body FROM t;"]);
    const stdout = cli.stdout.toString();
    const stderr = cli.stderr.toString();
    console.log(`[sqlite3 stdout]\n${stdout}`);
    if (stderr) console.log(`[sqlite3 stderr]\n${stderr}`);

    if (cli.exitCode !== 0) {
      console.error("\nFAIL: sqlite3 CLI could not read the exported file.");
      process.exit(1);
    }
    if (!stdout.includes("hello from the worker")) {
      console.error("\nFAIL: sqlite3 CLI opened the file but the expected row wasn't found.");
      process.exit(1);
    }

    console.log("\nPASS: all three headless checks succeeded.");
  } finally {
    await browser.close();
    server.stop(true);
  }
}

main();

// Headless end-to-end check for phoneDb.ts (docs/direction.md "A. Foundation" #4). Not part of the app,
// its build, or `bun test` — run manually with:
//
//   bun run frontend/scripts/verify-phone-db/run.ts
//
// This needs real module resolution: phoneDb.ts uses the `@/` alias, the `@threadz/core` workspace package,
// and Vite's `new Worker(new URL(...), { type: "module" })` pattern. So this spins up a real Vite dev
// server (frontend's own root, no app plugins needed) and points a headless, iPhone-sized Chromium at
// client.ts, which drives the actual public API: open two independent phone dbs, write to each through
// the real Driver (a real worker, real @subframe7536/sqlite-wasm, real IndexedDB), export one, import it
// into the other, and check the merge landed with the same content-wins / last-write-wins rules
// core/merge.ts enforces everywhere else. Finally, the exported bytes are written to disk and opened with
// the `sqlite3` CLI to confirm they're a real, readable database file.
import { chromium, devices } from "playwright";
import { createServer } from "vite";

const PORT = 8993;
const OUT_DB = "/tmp/threadz-verify-phone-db-export.sqlite";
const FRONTEND_ROOT = new URL("../../", import.meta.url).pathname;
// bun's workspace symlinks (frontend/node_modules/@subframe7536 → the repo's central node_modules/.bun
// store) point outside frontend/, so Vite's dev-server file guard needs the repo root too, not just
// frontend/ — this ad hoc server has no other reason to restrict it further.
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>phoneDb verify</title></head>
  <body><script type="module" src="/scripts/verify-phone-db/client.ts"></script></body>
</html>`;

async function main() {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: false,
    resolve: { alias: { "@": `${FRONTEND_ROOT}src` } },
    server: { port: PORT, fs: { allow: [REPO_ROOT] } },
    // Vite's dependency scanner otherwise auto-discovers frontend/index.html (the real app's entry, which
    // pulls in VitePWA's `virtual:pwa-register` — a virtual module only the app's own vite.config.ts
    // registers) and chokes on it. Point it only at our own entry so it optimizes what client.ts actually
    // needs (@subframe7536/sqlite-wasm, @threadz/core) instead.
    optimizeDeps: {
      entries: ["scripts/verify-phone-db/client.ts"],
      // Pre-bundling this package churns its wasm asset through Vite's dep cache and, during this ad hoc
      // server's dependency (re-)optimization, that cache goes stale mid-request — the wasm fetch comes
      // back as Vite's HTML fallback instead of bytes. It's already pure ESM; serve it straight from
      // node_modules.
      exclude: ["@subframe7536/sqlite-wasm"],
    },
    plugins: [
      {
        name: "verify-phone-db-page",
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (req.url === "/") {
              res.setHeader("content-type", "text/html");
              res.end(HTML);
            } else next();
          });
        },
      },
    ],
  });
  await server.listen(PORT);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[browser error] ${err}`));
    page.on("response", (res) => {
      if (res.url().includes("wasm") || res.status() >= 400) console.log(`[net] ${res.status()} ${res.url()}`);
    });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window as unknown as { __verifyDone?: boolean }).__verifyDone === true, {
      timeout: 30_000,
    });

    const report = await page.evaluate(() => (window as unknown as { __verifyResult: unknown }).__verifyResult);
    console.log("\n=== phoneDb verify report ===");
    console.log(JSON.stringify(report, null, 2));

    // biome-ignore lint/suspicious/noExplicitAny: throwaway verification script, shape is whatever the page posted
    const r = report as any;
    if (!r?.ok) {
      console.error("\nFAIL: one or more checks failed.");
      process.exit(1);
    }

    // Re-derive the exported bytes independently (rather than trusting the in-page report) by asking the
    // page to dump A again and hand the bytes out as base64.
    const base64 = await page.evaluate(async () => {
      const { openPhoneDb } = await import("/src/lib/phoneDb.ts");
      const db = await openPhoneDb("verify-a.sqlite");
      const bytes = await db.dump();
      await db.close();
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });
    await Bun.write(OUT_DB, Buffer.from(base64, "base64"));
    console.log(`\nWrote exported db to ${OUT_DB}, opening with the sqlite3 CLI...`);

    const cli = Bun.spawnSync(["sqlite3", OUT_DB, ".tables", "SELECT id, title FROM threads ORDER BY id;"]);
    console.log(`[sqlite3 stdout]\n${cli.stdout.toString()}`);
    if (cli.stderr.toString()) console.log(`[sqlite3 stderr]\n${cli.stderr.toString()}`);
    if (cli.exitCode !== 0) {
      console.error("\nFAIL: sqlite3 CLI could not read the exported file.");
      process.exit(1);
    }

    console.log("\nPASS: real worker + real sqlite-wasm + real IndexedDB round-trip, merge-on-import, and a CLI-readable export all check out.");
  } finally {
    await browser.close();
    await server.close();
  }
}

main();

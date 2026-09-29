// Repeatable perf harness (docs/direction.md "Round 8" #5). Not part of the app or `bun test`.
//
//   VITE_LOCAL=1 bun run --cwd frontend build       # a production build first
//   bun run seed --scale real                       # .seed/real.sqlite (the harness makes its own --stamp copy)
//   bun run frontend/scripts/perf/run.ts [--scale real] [--runs 5] [--rate 4] [--only thread,search,...]
//
// It serves dist/ with `vite preview`, starts a backend on :8787 over a stamped copy of the seed, and for every sample
// opens a fresh headless Chromium context at iPhone size with a CPU throttle, loads the seed through Settings >
// Import, reloads cold and times one lens; the table is the median of --runs samples. Every worker round trip and fetch
// is logged by an init script, with the worker's own exec time, so the report says how many SQL round trips a lens
// costs and how long the worker spent, not only how long the tap took.
//
// Limit: CDP can throttle the page's main thread but not a dedicated worker ("only supported for pages"), so SQL runs
// at desktop speed. The "est." column adds (rate - 1) x the worker's exec time to the measured time, i.e. it assumes
// the worker is as slow as the throttled page and that its time is on the critical path (an upper bound).
// --dump prints the load-time worker statements and a timeline for the thread scenario; --profile prints the main
// thread's heaviest functions; --dist <dir> measures another build (an older revision's, say) for a before column.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { chromium, devices, type Page } from "playwright";
import { preview } from "vite";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const SCALE = opt("scale", "real");
const RUNS = Number(opt("runs", "5"));
const RATE = Number(opt("rate", "4"));
const ONLY = opt("only", "")
  .split(",")
  .filter(Boolean);
const FRONTEND = new URL("../../", import.meta.url).pathname;
const ROOT = new URL("../../../", import.meta.url).pathname;
const SEED = `${ROOT}.seed/${SCALE}.sqlite`;
const STAMPED = `${ROOT}.seed/${SCALE}-stamped.sqlite`; // main's database (the backend opens it in WAL mode)
const PHONE_FILE = `${ROOT}.seed/${SCALE}-phone.sqlite`; // the same rows, rollback-journal mode: what Import takes
const PORT = 4179;
const BACKEND_PORT = 8787;

const BUDGET: Record<string, number> = { thread: 150, search: 200, todos: 200, home: 300, map: 500, sync: 100 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

// What to look for, taken from the seed itself so a run is comparable across machines.
const pickTargets = () => {
  const db = new Database(SEED, { readonly: true });
  const thread = db
    .query<{ id: string; title: string; n: number }, []>(
      `SELECT t.id, t.title, COUNT(*) n FROM threads t JOIN entities e ON e.id = t.id
       JOIN messages m ON m.thread_id = t.id AND m.removed_at IS NULL
       WHERE e.deleted_at IS NULL GROUP BY t.id HAVING n BETWEEN 8 AND 30 ORDER BY n DESC, t.id LIMIT 1`,
    )
    .get();
  const words = new Set<string>();
  for (const r of db.query<{ content: string }, []>("SELECT content FROM note_versions LIMIT 300").all())
    for (const w of r.content.toLowerCase().match(/[a-z]{6,}/g) ?? []) words.add(w);
  let term = "";
  for (const w of words) {
    const titles = db.query<{ c: number }, [string]>("SELECT COUNT(*) c FROM threads WHERE title LIKE ?").get(`%${w}%`);
    const hits = db.query<{ c: number }, [string]>("SELECT COUNT(*) c FROM note_versions WHERE content LIKE ?").get(`%${w}%`);
    if (!titles?.c && hits && hits.c >= 200 && hits.c <= 5000) {
      term = w;
      break;
    }
  }
  db.close();
  if (!thread || !term) throw new Error("could not pick a thread / search term from the seed");
  return { thread, term };
};

// Runs in every page before the app: logs each worker round trip and fetch, and keeps a live in-flight count.
const INIT = `(() => {
  const log = (window.__perf = { ops: [], inflight: 0, lastDone: 0 });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...a) {
      super(...a);
      const pending = new Map();
      this.addEventListener('message', (e) => {
        const p = pending.get(e.data && e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        p.t1 = performance.now(); p.exec = e.data.ms;
        log.inflight--; log.lastDone = p.t1;
      });
      const post = this.postMessage.bind(this);
      this.postMessage = (msg, ...r) => {
        const op = { kind: 'sql', type: msg && msg.type, sql: msg && msg.sql, t0: performance.now(), t1: 0 };
        if (msg && msg.type !== 'open') { pending.set(msg.id, op); log.ops.push(op); log.inflight++; }
        return post(msg, ...r);
      };
    }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (...a) => {
    const op = { kind: 'fetch', sql: String(a[0]), t0: performance.now(), t1: 0 };
    log.ops.push(op); log.inflight++;
    return nativeFetch(...a).finally(() => { op.t1 = performance.now(); log.inflight--; log.lastDone = op.t1; });
  };
  // Resolves the ms from now until pred() holds (checked every frame), or -1 after timeoutMs.
  window.__until = (pred, timeoutMs) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch {}
      if (ok) return resolve(performance.now() - t0);
      if (performance.now() - t0 > timeoutMs) return resolve(-1);
      requestAnimationFrame(tick);
    };
    tick();
  });
  window.__measure = (trigger, ready, timeoutMs) => new Promise((resolve) => {
    const t0 = performance.now();
    window.__perf.t0 = t0;
    new Function(trigger)();
    const pred = new Function(ready);
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch {}
      if (ok) return resolve(performance.now() - t0);
      if (performance.now() - t0 > timeoutMs) return resolve(-1);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // First time each panel shows its data after a cold load (ms since navigation start). Cheap checks only: they run
  // every frame and must not disturb what they time.
  window.__ready = {};
  const marks = {
    list: () => !!document.querySelector('button[aria-current]'),
    todos: () => [...document.querySelectorAll('header')].some((h) => /\\d+ open · \\d+ closed/i.test(h.textContent || '')),
    home: () => [...document.querySelectorAll('section')].some((e) => /^\\s*recent/i.test(e.textContent || '')),
  };
  const watch = () => {
    for (const [k, f] of Object.entries(marks)) if (!(k in window.__ready)) { try { if (f()) window.__ready[k] = performance.now(); } catch {} }
    if (Object.keys(window.__ready).length < Object.keys(marks).length) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  // Resolves once nothing was in flight for quietMs; the answer is (time of the last completion - t0).
  window.__quiet = (t0, quietMs, timeoutMs) => new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const now = performance.now();
      if (log.inflight === 0 && now - Math.max(log.lastDone, t0) >= quietMs) return resolve(Math.max(log.lastDone, t0) - t0);
      if (now - start > timeoutMs) return resolve(-1);
      setTimeout(tick, 10);
    };
    tick();
  });
})();`;

type Sample = { ms: number; trips: number; sqlMs: number };
type Op = { kind: string; t0: number; t1: number; exec?: number };
// Round trips to the worker and the time the worker itself spent on them (its own clock; queue wait excluded).
const summarize = (ops: Op[]) => {
  const sql = ops.filter((o) => o.kind === "sql" && o.t1);
  return { trips: sql.length, sqlMs: sql.reduce((n, o) => n + (o.exec ?? 0), 0) };
};

type PerfWindow = {
  __perf: { ops: Op[]; t0: number; rowAt?: number };
  __measure: (trigger: string, ready: string, timeoutMs: number) => Promise<number>;
  __quiet: (t0: number, quietMs: number, timeoutMs: number) => Promise<number>;
};

// The timed step happens inside the page (trigger, then wait for `ready`), so Playwright's own actionability waits on
// the throttled main thread are not part of the number. `trigger` and `ready` are function bodies as source text.
const measure = async (page: Page, trigger: string, ready: string): Promise<Sample> => {
  await page.evaluate(() => (window as unknown as PerfWindow).__perf.ops.splice(0));
  const ms = await page.evaluate(([t, r]) => (window as unknown as PerfWindow).__measure(t as string, r as string, 30_000), [trigger, ready] as const);
  const ops = await page.evaluate(() => (window as unknown as PerfWindow).__perf.ops);
  if (args.includes("--dump"))
    for (const o of [...(ops as (Op & { sql?: string })[])].sort((a, b) => (b.exec ?? 0) - (a.exec ?? 0)).slice(0, 4))
      console.log(`  ${(o.exec ?? 0).toFixed(0).padStart(5)}ms  ${o.sql?.replace(/\s+/g, " ").slice(0, 100)}`);
  return { ms, ...summarize(ops) };
};

const shown = "const shown = (e) => e.getClientRects().length > 0;";

// Every scenario starts on the Threads index after a cold load and returns its own timing.
const scenarios = (targets: ReturnType<typeof pickTargets>) => ({
  // Tap a thread row; done when its first message's text is on screen.
  thread: async (page: Page) => {
    // The index is windowed, so scroll (untimed) until the target row is mounted, as a person would.
    await page.evaluate(async (title) => {
      const find = () => [...document.querySelectorAll("button[aria-current]")].find((b) => b.textContent?.includes(title));
      const list = document.querySelector("button[aria-current]")?.closest(".overflow-y-auto");
      for (let y = 0; list && !find() && y < list.scrollHeight; y += list.clientHeight / 2) {
        list.scrollTop = y;
        await new Promise((r) => setTimeout(r, 50));
      }
    }, targets.thread.title);
    const sample = await measure(
      page,
      `[...document.querySelectorAll('button[aria-current]')].find((b) => b.textContent.includes(${JSON.stringify(targets.thread.title)})).click();`,
      `const row = document.getElementsByTagName('main')[0]?.querySelector('[data-index]');
       if (row && !window.__perf.rowAt) window.__perf.rowAt = performance.now();
       return !!row && (row.textContent || '').trim().length > 10;`,
    );
    if (args.includes("--dump")) {
      const { ops, t0, rowAt } = await page.evaluate(() => (window as unknown as { __perf: { ops: (Op & { sql?: string })[]; t0: number; rowAt?: number } }).__perf);
      console.log(`  thread rows in the DOM at +${((rowAt ?? 0) - t0).toFixed(0)}ms; last worker reply at +${(Math.max(...ops.map((o) => o.t1)) - t0).toFixed(0)}ms`);
      for (const o of ops.slice(0, 40))
        console.log(`  +${(o.t0 - t0).toFixed(0).padStart(4)} -> +${(o.t1 - t0).toFixed(0).padStart(4)}  exec ${(o.exec ?? 0).toFixed(1).padStart(6)}  ${(o as { sql?: string }).sql?.replace(/\s+/g, " ").slice(0, 90)}`);
    }
    return sample;
  },
  // Type a query into the index search. The number is the worker's time for the search (first request to last
  // reply): useThreads waits 200ms before it asks, so the visible delay is that plus this.
  search: async (page: Page) => {
    const sample = await measure(
      page,
      `const input = document.querySelector('input[aria-label="Search threads"]');
       Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(targets.term)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
      `return window.__perf.ops.length > 0 && window.__perf.inflight === 0 && performance.now() - window.__perf.lastDone > 300;`,
    );
    const ops = await page.evaluate(() => (window as unknown as PerfWindow).__perf.ops.filter((o) => o.kind === "sql"));
    const first = ops.reduce((m, o) => Math.min(m, o.t0), Number.POSITIVE_INFINITY);
    const last = ops.reduce((m, o) => Math.max(m, o.t1), 0);
    return { ...sample, ms: ops.length ? last - first : -1 };
  },
  // Tap the Todos tab; done when the panel is on screen with its counts. The panels mount at load and read their data
  // then (see boot), so this is the tap itself plus rendering the list.
  todos: (page: Page) =>
    measure(
      page,
      `document.querySelector('label[title="Todos"] input').click();`,
      `return [...document.querySelectorAll('header')].some((h) => /\\d+ open · \\d+ closed/i.test(h.textContent || '') && !h.closest('[inert]'));`,
    ),
  // Tap the app mark; done when Home is on screen with its rows.
  home: (page: Page) =>
    measure(
      page,
      `document.querySelector('button[aria-label="Home"]').click();`,
      `return [...document.querySelectorAll('section')].some((e) => /loose notes/i.test(e.textContent || '') && !e.closest('[inert]'));`,
    ),
  // Open /map; done when the tracks are drawn.
  map: (page: Page) =>
    measure(
      page,
      `history.pushState(null, '', '/map'); dispatchEvent(new PopStateEvent('popstate'));`,
      `return !!document.querySelector('[data-testid=map-scroller]');`,
    ),
});

// Throttles every page and worker target of the browser (attached after the import, which runs unthrottled).
const cpuThrottle = async (wsUrl: string, initialRate: number) => {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const send = (method: string, params: object = {}, sessionId?: string) =>
    ws.send(JSON.stringify({ id: ++n, method, params, ...(sessionId ? { sessionId } : {}) }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as { method?: string; error?: unknown; params?: { sessionId: string; targetInfo: { type: string } } };
    if (m.error && process.env.CDP_DEBUG) console.log("cdp error:", JSON.stringify(m.error));
    if (m.method === "Target.attachedToTarget" && process.env.CDP_DEBUG) console.log("attached:", m.params?.targetInfo.type);
    if (m.method !== "Target.attachedToTarget" || !m.params) return;
    const { sessionId, targetInfo } = m.params;
    if (["page", "worker", "dedicated_worker"].includes(targetInfo.type)) {
      send("Emulation.setCPUThrottlingRate", { rate: initialRate }, sessionId);
    }
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    send("Runtime.runIfWaitingForDebugger", {}, sessionId);
  });
  send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  return {
    close: () => ws.close(),
  };
};

// A keep-live tick with nothing to send: push an empty changeset, pull since the cursor. The first click is a warm-up.
const syncOnce = async (page: Page): Promise<Sample> => {
  await page.locator('label[title="Settings"]').click();
  const click = `document.querySelector('[aria-label="Sync now"]').click();`;
  const QUIET = 150; // the wait ends after this much idle time; taken back off below
  const idle = `performance.now() - window.__perf.lastDone > ${QUIET} && window.__perf.inflight === 0`;
  await measure(page, click, `return ${idle};`);
  await page.waitForTimeout(2000);
  const sample = await measure(page, click, `return window.__perf.ops.length > 0 && ${idle};`);
  return { ...sample, ms: sample.ms - QUIET };
};

// Where the worker's time goes at load: every request since navigation, its exec time as the worker measured it
// (queue wait and main-thread delay excluded), grouped by statement.
const bootDump = async (page: Page): Promise<string> => {
  await page.waitForTimeout(10_000);
  const ready = await page.evaluate(() => (window as unknown as { __ready: Record<string, number> }).__ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const metric = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
  console.log(`page after load: ${metric("Nodes")} DOM nodes, ${(metric("JSHeapUsedSize") / 1e6).toFixed(0)} MB JS heap`);
  console.log("ready after a cold load (ms since navigation):", JSON.stringify(ready, (_k, v) => (typeof v === "number" ? Math.round(v) : v)));
  const ops = await page.evaluate(() => (window as unknown as { __perf: { ops: (Op & { sql?: string })[] } }).__perf.ops);
  const groups = new Map<string, { n: number; ms: number }>();
  for (const o of ops.filter((x) => x.kind === "sql" && x.t1)) {
    const key = (o.sql ?? o.kind).replace(/\s+/g, " ").slice(0, 110);
    const g = groups.get(key) ?? { n: 0, ms: 0 };
    g.n++;
    g.ms += o.exec ?? 0;
    groups.set(key, g);
  }
  const lines = [...groups]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 14)
    .map(([k, g]) => `${String(g.n).padStart(6)} ${g.ms.toFixed(0).padStart(7)}  ${k}`);
  return `\nworker exec time at load, by statement (count, ms):\n${lines.join("\n")}`;
};

const main = async () => {
  if (!existsSync(SEED)) throw new Error(`missing ${SEED} — run: bun run seed --scale ${SCALE}`);
  if (!existsSync(`${opt("dist", `${FRONTEND}dist`)}/index.html`)) throw new Error("missing frontend/dist — run: VITE_LOCAL=1 bun run --cwd frontend build");
  const targets = pickTargets();
  console.log(`thread "${targets.thread.title}" (${targets.thread.n} messages), search term "${targets.term}", ${RATE}x throttle, median of ${RUNS}`);

  await Bun.spawn(["bun", "scripts/seed.ts", "--scale", SCALE, "--stamp", "--out", STAMPED], { cwd: ROOT, stdout: "ignore" }).exited;
  // The wasm side can't open a WAL-mode file (it fails with "unable to open database file"), so copy before main opens it.
  copyFileSync(STAMPED, PHONE_FILE);
  const copy = new Database(PHONE_FILE);
  copy.run("PRAGMA journal_mode = DELETE");
  copy.close();
  const backend = Bun.spawn(["bun", "backend/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, THREADZ_DB: STAMPED, PORT: String(BACKEND_PORT), THREADZ_BACKUPS: `${ROOT}.seed/backups` },
    stdout: "ignore",
    stderr: "ignore",
  });
  const server = await preview({
    root: FRONTEND,
    configFile: `${FRONTEND}vite.config.ts`,
    build: { outDir: opt("dist", `${FRONTEND}dist`) }, // --dist <dir>: measure another build, e.g. one of an older commit
    preview: { port: PORT, strictPort: true },
  });
  const url = `http://localhost:${PORT}/`;

  const browser = await chromium.launch({ args: ["--remote-debugging-port=9333"] });
  const version = (await (await fetch("http://127.0.0.1:9333/json/version")).json()) as { webSocketDebuggerUrl: string };
  const cdp = await cpuThrottle(version.webSocketDebuggerUrl, RATE);
  const run = scenarios(targets);
  const importSeconds: number[] = [];
  try {
    // Every sample gets a fresh browser context (its own IndexedDB): import the seed through Settings > Import, then
    // reload so the app starts cold on a warm database, as it does on a phone.
    const sample = async (name: keyof typeof run | "boot" | "sync"): Promise<Sample | string> => {
      const context = await browser.newContext({ ...devices["iPhone 13"] });
      try {
        await context.addInitScript(INIT);
        const page = await context.newPage();
        page.on("pageerror", (e) => console.log("pageerror:", e.message));
        await page.goto(url);
        if (!importSeconds.length) {
          // Calibration: how much busy work fits in 200ms on the main thread (compare --rate 1 with the throttled rate).
          const spins = await page.evaluate(() => {
            const t = performance.now();
            let n = 0;
            while (performance.now() - t < 200) n++;
            return n;
          });
          console.log(`main-thread spins per 200ms: ${(spins / 1e6).toFixed(1)}M`);
        }
        await page.locator('label[title="Settings"]').click();
        const t0 = performance.now();
        await page.locator('input[accept^=".sqlite"]').setInputFiles(PHONE_FILE);
        const note = page.locator("section", { hasText: "Import / export" }).locator("p").last();
        let outcome = "";
        while (!/^Imported|rror|nable|ailed/.test(outcome)) {
          await page.waitForTimeout(500);
          outcome = (await note.textContent()) ?? "";
        }
        if (!outcome.startsWith("Imported")) throw new Error(`import failed: ${outcome}`);
        importSeconds.push((performance.now() - t0) / 1000);
        await page.evaluate(() => {
          localStorage.setItem("threadz.rev", "1"); // the stamped seed is main's rev 1
          localStorage.removeItem("threadz.lastRoute"); // else the reload reopens the last thread
        });
        await page.goto(url);
        await page.locator("button[aria-current]").first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(3000); // the app's own load-time reads settle first
        if (name === "boot") return await bootDump(page);
        if (name === "sync") return await syncOnce(page);
        if (!args.includes("--profile")) return await run[name](page);
        // --profile: print the main thread's heaviest functions (self time) while the scenario runs.
        const cdpPage = await context.newCDPSession(page);
        await cdpPage.send("Profiler.enable");
        await cdpPage.send("Profiler.start");
        const result = await run[name](page);
        const { profile } = (await cdpPage.send("Profiler.stop")) as {
          profile: {
            nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number } }[];
            samples: number[];
            timeDeltas: number[];
          };
        };
        const self = new Map<number, number>();
        profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
        for (const [id, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
          const n = profile.nodes.find((x) => x.id === id);
          console.log(
            `${(us / 1000).toFixed(0).padStart(6)}ms ${n?.callFrame.functionName || "(anon)"} ${n?.callFrame.url.split("/").pop()}:${n?.callFrame.lineNumber}:${n?.callFrame.columnNumber}`,
          );
        }
        return result;
      } finally {
        await context.close();
      }
    };

    const results: Record<string, { ms: number[]; trips: number; sqlMs: number }> = {};
    for (const name of ["thread", "search", "todos", "home", "map", "sync"] as const) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const samples: Sample[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await sample(name);
        if (typeof r === "string") throw new Error(r);
        samples.push(r);
      }
      results[name] = {
        ms: samples.map((s) => s.ms),
        trips: median(samples.map((s) => s.trips)),
        sqlMs: median(samples.map((s) => s.sqlMs)),
      };
    }
    if (!ONLY.length || ONLY.includes("boot")) console.log(await sample("boot"));
    console.log(`import: ${median(importSeconds).toFixed(1)}s median at ${RATE}x`);

    console.log(`\n| lens | median ms | est. worker ${RATE}x | budget | worker round trips | worker exec ms | all runs |`);
    console.log("|---|---|---|---|---|---|---|");
    for (const [name, r] of Object.entries(results)) {
      const m = median(r.ms);
      console.log(
        `| ${name} | ${m.toFixed(0)} | ${m < 0 ? "-" : (m + (RATE - 1) * r.sqlMs).toFixed(0)} | <${BUDGET[name]} ${m >= 0 && m <= (BUDGET[name] ?? 0) ? "ok" : "MISS"} | ${r.trips} | ${r.sqlMs.toFixed(0)} | ${r.ms.map((x) => x.toFixed(0)).join(", ")} |`,
      );
    }
    cdp.close();
  } finally {
    await browser.close();
    await server.close();
    backend.kill();
  }
};

await main();

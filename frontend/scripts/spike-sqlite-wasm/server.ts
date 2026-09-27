// Throwaway static server for the @subframe7536/sqlite-wasm spike. Not part
// of the app or its build — just enough to serve index.html/worker.js and the
// package (which the worker imports as bare "/node_modules/..." paths, since
// there's no bundler in this spike) to a Playwright-driven browser.
//
// Copied from ../spike-wa-sqlite/server.ts (kept identical on purpose — no
// reason for the two throwaway harnesses to drift).
import { extname, join, normalize } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const FRONTEND_ROOT = join(HERE, "..", "..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

export const startSpikeServer = (port: number) =>
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let path = decodeURIComponent(url.pathname);
      if (path === "/") path = "/index.html";

      const root = path.startsWith("/node_modules/") ? FRONTEND_ROOT : HERE;
      const filePath = normalize(join(root, path));
      // Basic containment check — this only ever serves our own throwaway tree.
      if (!filePath.startsWith(root)) return new Response("forbidden", { status: 403 });

      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("not found", { status: 404 });

      const type = MIME[extname(filePath)] ?? "application/octet-stream";
      return new Response(file, { headers: { "content-type": type } });
    },
  });

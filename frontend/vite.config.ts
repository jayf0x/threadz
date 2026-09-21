import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

// @ricky0123/vad-web loads its worklet, the Silero model, and the onnxruntime
// wasm at runtime from relative paths. Serve them from /vad/ (self-hosted, no
// CDN) so voice capture works offline and inside the installed PWA.
const vadAssets = "node_modules/@ricky0123/vad-web/dist";
const ortAssets = "node_modules/onnxruntime-web/dist";

// Served from "/" by default; the GitHub Pages build sets VITE_BASE=/threadz/ (see `bun run pages:build`).
// Vite normalises the trailing slash and exposes it to app code as import.meta.env.BASE_URL.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // listen on 0.0.0.0 so the phone can load the app too; `.ts.net` lets `tailscale serve` (HTTPS) proxy in
  server: { host: true, allowedHosts: [".ts.net"] },
  // vad-web and transformers.js are only reached on first mic tap; prebundle them so dev doesn't
  // discover them late and reload the page mid-dictation
  optimizeDeps: { include: ["@ricky0123/vad-web", "@huggingface/transformers"] },
  plugins: [
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: `${vadAssets}/vad.worklet.bundle.min.js`, dest: "vad", rename: { stripBase: true } },
        { src: `${vadAssets}/silero_vad_v5.onnx`, dest: "vad", rename: { stripBase: true } },
        { src: `${ortAssets}/ort-wasm-simd-threaded.wasm`, dest: "vad", rename: { stripBase: true } },
        { src: `${ortAssets}/ort-wasm-simd-threaded.mjs`, dest: "vad", rename: { stripBase: true } },
      ],
    }),
    VitePWA({
      // autoUpdate, not prompt: nothing in the app ever accepted a "prompt" update, so a new build's
      // service worker waited forever behind the old one and an open tab kept showing the old UI.
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,ico}"],
        // 512px icons are photo-textured (~0.5MB together) and only read when installing — not worth precaching
        globIgnores: ["icon-512.png", "icon-maskable-512.png"],
        // Model assets (VAD onnx/wasm + the ~40MB whisper weights & onnxruntime
        // wasm) are fetched on first use and runtime-cached, not precached.
        // Voice-to-text works offline only after one online use; the VAD assets
        // are small so voice *capture* is usable offline right after that.
        runtimeCaching: [
          {
            // Runs inside the service worker, so it cannot close over `base`: the SW scope *is* the base.
            urlPattern: ({ url }) =>
              url.pathname.endsWith(".wasm") ||
              url.pathname.endsWith(".onnx") ||
              url.pathname.startsWith(new URL("vad/", self.registration.scope).pathname) ||
              url.host === "huggingface.co",
            handler: "CacheFirst",
            options: { cacheName: "threadz-models", expiration: { maxEntries: 30 } },
          },
        ],
      },
      manifest: {
        name: "Threadz — Personal Brain",
        short_name: "Threadz",
        theme_color: "#f8f5ee",
        background_color: "#f8f5ee",
        display: "standalone",
        icons: [
          { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `${base}icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});

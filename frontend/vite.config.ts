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

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // listen on 0.0.0.0 so the phone can load the app too; `.ts.net` lets `tailscale serve` (HTTPS) proxy in
  server: { host: true, allowedHosts: [".ts.net"] },
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
      registerType: "prompt",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png}"],
        // Model assets (VAD onnx/wasm + the ~40MB whisper weights & onnxruntime
        // wasm) are fetched on first use and runtime-cached, not precached.
        // Voice-to-text works offline only after one online use; the VAD assets
        // are small so voice *capture* is usable offline right after that.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.endsWith(".wasm") ||
              url.pathname.endsWith(".onnx") ||
              url.pathname.startsWith("/vad/") ||
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
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});

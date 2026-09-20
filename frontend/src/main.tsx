import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles.css";
import { BACKEND_URL } from "@/lib/config";

registerSW({ immediate: true });

// Tells the backend a tab is open; the desktop launcher quits when the last one closes.
new EventSource(`${BACKEND_URL}/api/presence`);

window.addEventListener("error", (e) => console.error("[threadz]", e.error));
window.addEventListener("unhandledrejection", (e) => console.error("[threadz]", e.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

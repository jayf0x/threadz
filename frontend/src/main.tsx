import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles.css";
import { registerUpdates } from "@/features/updates";
import { getBackendUrl, HAS_BACKEND } from "@/lib/config";

registerUpdates();

// Tells the backend a tab is open; the desktop launcher quits when the last one closes.
if (HAS_BACKEND) new EventSource(`${getBackendUrl()}/api/presence`);

window.addEventListener("error", (e) => console.error("[threadz]", e.error));
window.addEventListener("unhandledrejection", (e) => console.error("[threadz]", e.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

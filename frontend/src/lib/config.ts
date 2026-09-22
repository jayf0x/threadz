import { getSettings } from "./settings";

// The backend is static by default: VITE_BACKEND_URL at build time, else same host as the
// page on :8787 (the Mac's LAN IP when the phone loads the app from it). That guess is wrong if
// the page was ever opened as `localhost` on the phone itself (installing there points the app at
// itself, permanently — the device-only "Backend URL" override in Settings is the only way out,
// since reinstalling doesn't help). Read fresh per call, not cached, so the override applies
// without a reload.
const env = import.meta.env.VITE_BACKEND_URL as string | undefined;

// Exported so Settings can show it as the override field's placeholder.
export const DEFAULT_BACKEND_URL = (env || `${location.protocol}//${location.hostname}:8787`).replace(/\/$/, "");

export const getBackendUrl = () => getSettings().backendUrl || DEFAULT_BACKEND_URL;

// A static VITE_LOCAL build (e.g. GitHub Pages) has no backend to talk to unless one is configured.
export const LOCAL_BUILD = !!import.meta.env.VITE_LOCAL;
export const HAS_BACKEND = !LOCAL_BUILD || !!env;

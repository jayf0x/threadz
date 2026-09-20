// The backend is static: VITE_BACKEND_URL at build time, else same host as the
// page on :8787 (the Mac's LAN IP when the phone loads the app from it).
const env = import.meta.env.VITE_BACKEND_URL as string | undefined;

export const BACKEND_URL = (env || `${location.protocol}//${location.hostname}:8787`).replace(/\/$/, "");

// A static VITE_LOCAL build (e.g. GitHub Pages) has no backend to talk to unless one is configured.
export const LOCAL_BUILD = !!import.meta.env.VITE_LOCAL;
export const HAS_BACKEND = !LOCAL_BUILD || !!env;

// The backend is static: VITE_BACKEND_URL at build time, else same host as the
// page on :8787 (the Mac's LAN IP when the phone loads the app from it).
const env = import.meta.env.VITE_BACKEND_URL as string | undefined;

export const BACKEND_URL = (env || `${location.protocol}//${location.hostname}:8787`).replace(/\/$/, "");

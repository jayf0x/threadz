// The `/map?...` route (no router in this app: App.tsx reads `location`). Relative to Vite's base, so the same
// code serves `/map` and the Pages build's `/threadz/map`. The query string is a `core` MapFilter
// (`parseMapFilter`), which is also what a Home insight links to.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

export const isMapPath = (pathname: string): boolean => pathname.replace(/\/+$/, "") === `${BASE}/map`;

export const mapUrl = (search: string): string => `${BASE}/map${search ? `?${search}` : ""}`;

export const homeUrl = (): string => `${BASE}/`;

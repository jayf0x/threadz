// The `?thread=<id>&msg=<id>` deep link: parsing an incoming URL, and building the URL that
// should be showing for whatever's currently open. Pure so App.tsx's URL-sync effect (the one
// place that ever calls `history.pushState`/`replaceState` now) can be tested without a browser location object.

/** What a `?thread=&msg=` (or bare) query string says to open. Either can be absent. */
export const parseDeepLink = (search: string): { threadId: string | null; messageId: string | null } => {
  const params = new URLSearchParams(search);
  return { threadId: params.get("thread"), messageId: params.get("msg") };
};

/** The query string for the given selection — `""` when nothing's open (a bare path). A message
 * id is only meaningful alongside a thread id; it's dropped if `threadId` is null. */
export const deepLinkSearch = (threadId: string | null, messageId: string | null): string => {
  if (!threadId) return "";
  const params = new URLSearchParams({ thread: threadId });
  if (messageId) params.set("msg", messageId);
  return params.toString();
};

/** The full `pathname?search#hash` for the given selection, built from the page's current
 * pathname/hash — the only two parts of `location` this feature doesn't own. */
export const deepLinkUrl = (pathname: string, hash: string, threadId: string | null, messageId: string | null) => {
  const search = deepLinkSearch(threadId, messageId);
  return pathname + (search ? `?${search}` : "") + hash;
};

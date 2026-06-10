// Detects when API data did NOT come from the live server.
//
// The PWA service worker caches GET /api/* with NetworkFirst: when the network
// fails it silently serves a cached copy, and the app looks "fine" while
// showing stale data. A cached Response keeps its original Date header, so a
// large header age means the response was served from cache, not the server.
// Network errors mean we are fully offline. Both cases are broadcast as window
// events so the UI (ConnectivityBanner) can warn the user instead of failing
// silently.

export const DATA_STALE_EVENT = "aibook:data-stale";
export const DATA_OFFLINE_EVENT = "aibook:data-offline";
export const DATA_FRESH_EVENT = "aibook:data-fresh";

// Allow for SW network timeout (10s) plus clock skew between client and server.
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

export type DataStaleDetail = { url: string; ageMs: number };
export type DataOfflineDetail = { url: string };

function emit(name: string, detail?: unknown) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/**
 * Drop-in replacement for fetch() on our own API routes. Resolves/rejects
 * exactly like fetch, but reports data freshness via window events.
 */
export async function freshFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    emit(DATA_OFFLINE_EVENT, { url: String(input) } satisfies DataOfflineDetail);
    throw err;
  }

  const dateHeader = res.headers.get("date");
  const ageMs = dateHeader ? Date.now() - new Date(dateHeader).getTime() : 0;
  if (res.ok && ageMs > STALE_THRESHOLD_MS) {
    emit(DATA_STALE_EVENT, { url: String(input), ageMs } satisfies DataStaleDetail);
  } else {
    emit(DATA_FRESH_EVENT);
  }
  return res;
}

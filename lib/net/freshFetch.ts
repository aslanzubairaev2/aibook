// Detects when API data did NOT come from the live server, and stops a
// hanging one from waiting forever.
//
// The PWA service worker caches GET /api/* with NetworkFirst: when the network
// fails it silently serves a cached copy, and the app looks "fine" while
// showing stale data. A cached Response keeps its original Date header, so a
// large header age means the response was served from cache, not the server.
//
// But `networkTimeoutSeconds` on that Workbox rule only gives an EARLY exit to
// the cache — if there is nothing cached yet for that exact URL (a fresh
// deploy, a first load, a POST the service worker never touches at all), it
// just keeps waiting on the real network call, same as a plain `fetch()`
// would. Neither the Gemini API nor Supabase enforce a ceiling of their own
// either. Without one here, a single slow request — a cold serverless start,
// a degraded upstream — can leave a skeleton spinning for minutes with no
// sign anything is wrong, which is exactly what a "hangs, then a real error
// or a real answer eventually shows up" bug report always turns out to be.
//
// Both a genuine network failure and a timeout here are reported the same
// way — from the caller's perspective, "no response" is "no response" either
// way — as window events so the UI (ConnectivityBanner) can warn the user
// instead of failing silently.

export const DATA_STALE_EVENT = "aibook:data-stale";
export const DATA_OFFLINE_EVENT = "aibook:data-offline";
export const DATA_FRESH_EVENT = "aibook:data-fresh";

// Allow for SW network timeout (10s) plus clock skew between client and server.
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

// How long any single call through this module waits before giving up.
// Generous enough for a cold serverless start or a slower AI generation
// (verb/noun form backfill, a grammar table), far short of the minutes a
// genuinely hung connection can otherwise run silently for.
const DEFAULT_TIMEOUT_MS = 20_000;

export type DataStaleDetail = { url: string; ageMs: number };
export type DataOfflineDetail = { url: string };

function emit(name: string, detail?: unknown) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/**
 * `fetch`, bounded.
 *
 * The one primitive every network call in the app should go through — not
 * just the reads that already use `freshFetch` below, but the AI lookups
 * (grammar, word analysis, discuss, verb phrases) that talk straight to
 * `fetch` today and inherit whatever the slowest link in the chain decides.
 *
 * A caller that cancels its own request (its own `signal` aborts) gets that
 * back untouched and silent, exactly like plain `fetch` would — only a
 * failure this function did not expect, including its own timeout, is worth
 * telling the rest of the app about.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (!externalSignal?.aborted) {
      emit(DATA_OFFLINE_EVENT, { url: String(input) } satisfies DataOfflineDetail);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Drop-in replacement for fetch() on our own API routes. Resolves/rejects
 * exactly like fetch, but reports data freshness via window events.
 */
export async function freshFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const res = await fetchWithTimeout(input, init, timeoutMs);

  const dateHeader = res.headers.get("date");
  const ageMs = dateHeader ? Date.now() - new Date(dateHeader).getTime() : 0;
  if (res.ok && ageMs > STALE_THRESHOLD_MS) {
    emit(DATA_STALE_EVENT, { url: String(input), ageMs } satisfies DataStaleDetail);
  } else {
    emit(DATA_FRESH_EVENT);
  }
  return res;
}

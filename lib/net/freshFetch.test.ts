import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout, freshFetch } from "./freshFetch.ts";

// Real production incident this guards against: a word-lookup or grammar
// request hung for several minutes with the skeleton spinning and nothing on
// screen to say anything had gone wrong — neither the PWA service worker's own
// network-timeout (which only helps when there is something cached to fall
// back to) nor the Gemini/Supabase calls underneath enforced any ceiling of
// their own. These tests prove the ceiling this module adds actually fires,
// using a fetch stand-in that only settles when its AbortSignal fires — the
// same shape a real hung `fetch()` has under an AbortController.

/** A `fetch` that never answers on its own — only reacts to its signal aborting. */
function neverAnswers(): typeof fetch {
  return (async (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  }) as typeof fetch;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } as Headers,
    json: async () => body,
  } as Response;
}

async function withFakeFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("a request that never answers is aborted rather than left to hang forever", async () => {
  await withFakeFetch(neverAnswers(), async () => {
    await assert.rejects(
      () => fetchWithTimeout("/api/ai/grammar", {}, 20),
      (err: unknown) => err instanceof DOMException && err.name === "AbortError",
    );
  });
});

test("the timeout does not fire early on a request that answers in time", async () => {
  const slowButFine: typeof fetch = (async (_input, init) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  await withFakeFetch(slowButFine, async () => {
    const res = await fetchWithTimeout("/api/ai/grammar", {}, 200);
    assert.equal(await res.json().then((b: { ok: boolean }) => b.ok), true);
  });
});

test("a caller's own cancellation still comes back as an abort, not swallowed", async () => {
  const controller = new AbortController();
  const promise = withFakeFetch(neverAnswers(), () =>
    fetchWithTimeout("/api/ai/grammar", { signal: controller.signal }, 5_000),
  );
  controller.abort();
  await assert.rejects(() => promise, (err: unknown) => err instanceof DOMException && err.name === "AbortError");
});

test("freshFetch resolves normally through the same timeout wrapper", async () => {
  const now = new Date().toUTCString();
  await withFakeFetch(
    (async () => jsonResponse({ entries: [] }, { date: now })) as typeof fetch,
    async () => {
      const res = await freshFetch("/api/dictionary?language=de");
      assert.equal(res.ok, true);
    },
  );
});

test("freshFetch propagates a hung request's abort instead of resolving with nothing", async () => {
  // The exact shape of the reported bug: Словарь stuck on "Загружаю
  // словарь..." — a caller awaiting freshFetch() must eventually see a
  // rejection, not silence. freshFetch always uses the 20s production default
  // unless told otherwise; the third argument exists so this can be proven in
  // milliseconds instead of actually waiting 20 real seconds in the suite.
  await withFakeFetch(neverAnswers(), async () => {
    await assert.rejects(
      () => freshFetch("/api/dictionary?language=de", undefined, 20),
      (err: unknown) => err instanceof DOMException && err.name === "AbortError",
    );
  });
});

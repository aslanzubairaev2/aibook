import test from "node:test";
import assert from "node:assert/strict";
import { AI_REQUEST_TIMEOUT_MS, DATA_OFFLINE_EVENT, DATA_TIMEOUT_EVENT, fetchWithTimeout, freshFetch } from "./freshFetch.ts";

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
      (err: unknown) => err instanceof DOMException && err.name === "TimeoutError",
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
      (err: unknown) => err instanceof DOMException && err.name === "TimeoutError",
    );
  });
});

test("AI request still waits at 20 seconds and returns the answer at 45 seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  await withFakeFetch((async (_url, init) => {
    calls++;
    signal = init?.signal;
    await new Promise(resolve => setTimeout(resolve, 45_000));
    assert.equal(signal?.aborted, false);
    return jsonResponse({ translation: "ответ" });
  }) as typeof fetch, async () => {
    const pending = fetchWithTimeout("/api/ai/analyze", {}, AI_REQUEST_TIMEOUT_MS);
    t.mock.timers.tick(20_001);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(25_000);
    assert.equal((await pending).status, 200);
    assert.equal(calls, 1);
  });
});

test("timeout is not reported as offline; a genuine network error still is", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events: string[] = [];
  const target = new EventTarget();
  target.addEventListener(DATA_TIMEOUT_EVENT, () => events.push("timeout"));
  target.addEventListener(DATA_OFFLINE_EVENT, () => events.push("offline"));
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  try {
    await withFakeFetch(neverAnswers(), async () => {
      await assert.rejects(fetchWithTimeout("/api/ai/analyze", {}, 10), { name: "TimeoutError" });
    });
    assert.deepEqual(events, ["timeout"]);
    await withFakeFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
      await assert.rejects(fetchWithTimeout("/api/ai/analyze"));
    });
    assert.deepEqual(events, ["timeout", "offline"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a pre-cancelled request is never sent to the server", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await withFakeFetch(async () => { calls++; return jsonResponse({}); }, async () => {
    await assert.rejects(fetchWithTimeout("/api/ai/analyze", { signal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, 0);
  });
});

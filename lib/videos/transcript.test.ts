import test from "node:test";
import assert from "node:assert/strict";

// Dummy credentials only. Every HTTP request below is mocked.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://cache.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-key";
process.env.SUPADATA_API_KEY = "test-only-supadata-key";
const { getTranscriptResult, TranscriptError } = await import("./youtubeTranscript.ts");
const { readTranscriptCache } = await import("./transcriptCacheServer.ts");
const { loadTranscript } = await import("./loadTranscript.ts");
const { searchYouTube } = await import("./youtubeSearch.ts");
const cues = [{ start: 0, end: 2, duration: 2, text: "Hallo Welt!" }];
const native = { content: [{ offset: 0, duration: 2000, text: "Hallo Welt!" }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Object.defineProperty(globalThis, "localStorage", { value: undefined, writable: true, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: undefined, writable: true, configurable: true });

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
}

test("native only, concurrent requests coalesce, durable cache is reusable", async t => {
  let providerCalls = 0;
  let saved: unknown = null;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("cache.example.test")) {
      if (init?.method === "POST") {
        saved = JSON.parse(String(init.body)).cues;
        return new Response(null, { status: 201 });
      }
      return json(saved ? [{ cues: saved }] : []);
    }
    assert.equal(new URL(url).searchParams.get("mode"), "native");
    providerCalls++;
    return json(native);
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => getTranscriptResult("cachetest01", "de")));
  assert.equal(providerCalls, 1);
  assert.deepEqual(results[0], { status: "completed", cues });
  assert.deepEqual(await readTranscriptCache("cachetest01", "de"), cues);
  // An uncached process/key reaches the database first, not Supadata.
  assert.deepEqual(await getTranscriptResult("cachetest02", "de"), { status: "completed", cues });
  assert.equal(providerCalls, 1);
});

test("job ID survives active responses and more than eight polls", async t => {
  let initialCalls = 0;
  let polls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("cache.example.test")) return init?.method === "POST" ? new Response(null, { status: 201 }) : json([]);
    if (url.includes("/job-long")) {
      polls++;
      return json(polls <= 12 ? { status: "active" } : { status: "completed", ...native });
    }
    initialCalls++;
    return json({ jobId: "job-long" }, 202);
  });
  for (let index = 0; index <= 12; index++) {
    assert.deepEqual(await getTranscriptResult("longtest001", "de"), { status: "pending", jobId: "job-long" });
  }
  assert.deepEqual(await getTranscriptResult("longtest001", "de"), { status: "completed", cues });
  assert.equal(initialCalls, 1);
  assert.equal(polls, 13);
});

test("quota exhaustion is terminal; temporary rate limit is retryable", async t => {
  let quota = true;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input).includes("cache.example.test") ? json([]) :
      json({ details: quota ? "Plan usage limit was exceeded." : "Too many requests" }, 429));
  await assert.rejects(getTranscriptResult("quotatest01"), e => e instanceof TranscriptError && !e.retryable && e.message.includes("лимит"));
  quota = false;
  await assert.rejects(getTranscriptResult("ratetest001"), e => e instanceof TranscriptError && e.retryable);
});

test("cache outage does not trigger paid requests", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.ok(String(input).includes("cache.example.test"), "Supadata must not be contacted");
    return json({ message: "unavailable" }, 503);
  });
  await assert.rejects(getTranscriptResult("dbdowntest1"), /Кэш субтитров/);
});

test("route exposes pending jobs as 202, not empty successful subtitles", async t => {
  const { GET } = await import("../../app/api/videos/transcript/route.ts");
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input).includes("cache.example.test") ? json([]) : json({ status: "active" }));
  const response = await GET(new Request("https://app.test/api/videos/transcript?v=routetest01&job=original-job"));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const data = await response.json();
  assert.equal(data.jobId, "original-job");
  assert.equal(data.cues, undefined);
});

test("unavailable native captions never trigger generation or overwrite the cache", async t => {
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("cache.example.test")) {
      assert.notEqual(init?.method, "POST");
      return json([]);
    }
    providerCalls++;
    return json({}, 206);
  });
  assert.deepEqual(await getTranscriptResult("missingtest"), { status: "unavailable", cues: [] });
  assert.equal(providerCalls, 1);
});

test("browser caches completed cues across openings without fetching again", async t => {
  t.mock.property(globalThis, "localStorage", storage());
  t.mock.property(globalThis, "sessionStorage", storage());
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return json({ cues, status: "completed" }); });
  assert.deepEqual(await loadTranscript("localtest01", "de", new AbortController().signal, () => {}), cues);
  assert.deepEqual(await loadTranscript("localtest01", "de", new AbortController().signal, () => {}), cues);
  assert.equal(requests, 1);
});

test("browser resumes saved job, survives transient errors and unlimited pending polls", async t => {
  const sessions = storage();
  sessions.setItem("aibook_native_transcript_job_v1:clienttest1:de", "saved-job");
  t.mock.property(globalThis, "sessionStorage", sessions);
  t.mock.property(globalThis, "localStorage", storage());
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.ok(String(input).includes("job=saved-job"));
    calls++;
    if (calls === 2) return json({ error: "temporary", retryable: true }, 503);
    return json(calls <= 13 ? { status: "pending", jobId: "saved-job" } : { status: "completed", cues }, calls <= 13 ? 202 : 200);
  });
  assert.deepEqual(await loadTranscript("clienttest1", "de", new AbortController().signal, () => {}), cues);
  assert.equal(calls, 14);
  assert.equal(sessions.getItem("aibook_native_transcript_job_v1:clienttest1:de"), null);
});

test("browser stops on permanent error and never stores empty subtitles", async t => {
  const local = storage();
  t.mock.property(globalThis, "localStorage", local);
  t.mock.property(globalThis, "sessionStorage", storage());
  t.mock.method(globalThis, "fetch", async () => json({ error: "Quota exhausted", retryable: false }, 422));
  await assert.rejects(loadTranscript("failedtest1", "de", new AbortController().signal, () => {}), /Quota exhausted/);
  assert.equal(local.getItem("aibook_transcript_cues_v1:failedtest1:de"), null);
});

test("closing player cancels waiting without creating another job", async t => {
  t.mock.property(globalThis, "localStorage", storage());
  t.mock.property(globalThis, "sessionStorage", storage());
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return json({ status: "pending", jobId: "cancel-job" }, 202); });
  await assert.rejects(loadTranscript("canceltest1", "de", controller.signal, () => controller.abort()));
  assert.equal(requests, 1);
});

test("search fallback does not request transcripts from Supadata", async t => {
  const oldKey = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  t.after(() => { if (oldKey) process.env.YOUTUBE_API_KEY = oldKey; });
  const video = { videoId: "searchtest1", title: { runs: [{ text: "Deutsch Test" }] }, lengthText: { simpleText: "3:00" } };
  const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ videoRenderer: video }] } }] } } } } };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(!url.includes("supadata"), "Search must not spend transcript credits");
    if (url.includes("/results?")) return new Response('var ytInitialData = ' + JSON.stringify(data) + ';</script>');
    if (url.includes("cache.example.test")) return json([]);
    return json({});
  });
  const result = await searchYouTube("unique-cache-regression", "de");
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].hasSubtitles, undefined);
});

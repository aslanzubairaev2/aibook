// What this file is really testing is money: every browser-cache miss is a
// paid round trip to a speech provider, and a miss looks exactly like a hit
// from the outside — the audio plays either way. Only the request count tells
// them apart, so that is what these assert.

import test from "node:test";
import assert from "node:assert/strict";

// ─── A browser, roughly ──────────────────────────────────────────────────────

type Entry = { body: string; headers: Map<string, string> };

const cacheStore = new Map<string, Entry>();

class FakeResponse {
  body: string;
  headers: Map<string, string>;
  constructor(body: string, init?: { headers?: Record<string, string> }) {
    this.body = body;
    this.headers = new Map(Object.entries(init?.headers ?? {}));
  }
}

class FakeCache {
  async match(key: string) {
    const hit = cacheStore.get(key);
    if (!hit) return undefined;
    return {
      text: async () => hit.body,
      headers: { get: (name: string) => hit.headers.get(name) ?? null },
    };
  }
  async put(key: string, res: FakeResponse) {
    cacheStore.set(key, { body: res.body, headers: res.headers });
  }
  async delete(key: string) {
    return cacheStore.delete(key);
  }
}

const localStore = new Map<string, string>();

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  async resume() {}
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel() {} };
  }
  createBufferSource() {
    return {
      buffer: null as unknown,
      onended: null as unknown,
      connect() {}, start() {}, stop() {}, disconnect() {},
    };
  }
}

const g = globalThis as Record<string, unknown>;
g.caches = { open: async () => new FakeCache() };
g.Response = FakeResponse;
g.AudioContext = FakeAudioContext;
g.localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => { localStore.set(k, v); },
  removeItem: (k: string) => { localStore.delete(k); },
};
g.window = globalThis;

/** One second of silence, in the raw 16-bit PCM the player schedules directly. */
const SILENCE = Buffer.from(new Uint8Array(2000)).toString("base64");

/** What the route answered with, and how many times it was asked. */
type Server = { reply: () => Record<string, unknown>; calls: number };

function serve(server: Server) {
  g.fetch = async () => {
    server.calls++;
    return { ok: true, json: async () => server.reply() };
  };
}

const {
  speak, respeak, getTTSState, getLastTtsError,
  prefetchSpeech, prefetchSpeechAhead, SPEECH_PREFETCH_AHEAD,
  GEMINI_PREFETCH_RPM_BUDGET, resetGeminiPrefetchPacing,
} = await import("./tts.ts");
const { saveLocalProfile } = await import("./db/local.ts");

/** Let the prefetches started without awaiting actually reach the network. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The pacing tests mock `setTimeout` (to fast-forward the per-minute wait
 * without a real minute passing), which leaves `settle()`'s own timer paused
 * too. Draining plain microtasks instead reaches the same place: every step
 * before a paced wait is `.then()` chaining, not a timer.
 */
async function flushMicrotasks(rounds = 200) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function useProvider(ttsProvider: string) {
  cacheStore.clear();
  localStore.clear();
  // Otherwise whatever an earlier case spent of the per-minute Gemini budget
  // is still spent, and a later case that never touches pacing on purpose
  // could find itself waiting out a real minute for a slot.
  resetGeminiPrefetchPacing();
  saveLocalProfile({
    nativeLanguage: "ru", targetLanguage: "de", uiLanguage: "ru",
    readingMinutes: 0, booksStarted: 0, booksFinished: 0, savedItems: 0,
    ttsProvider,
  } as never);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("the same line is spoken once and cached for every play after", async () => {
  useProvider("gemini");
  const server: Server = {
    calls: 0,
    reply: () => ({ audioBase64: SILENCE, provider: "gemini", model: "gemini-2.5-flash-preview-tts" }),
  };
  serve(server);

  await speak("Guten Tag!", "de");
  await speak("Guten Tag!", "de");
  await speak("Guten Tag!", "de");

  assert.equal(server.calls, 1);
});

test("a recording the fallback chain produced still answers the next play", async () => {
  // The case this was written for: Gemini's free allowance runs out, the route
  // quietly answers with OpenAI, and the learner changes nothing. Filing that
  // recording under OpenAI — the engine that spoke — left it where the next
  // play, which asks under Gemini, would never look. Every play was a fresh
  // request for as long as the quota stayed spent.
  useProvider("gemini");
  const server: Server = {
    calls: 0,
    reply: () => ({
      audioBase64: SILENCE,
      provider: "openai",
      model: "gpt-4o-mini-tts",
      fellBackFrom: "gemini",
      reason: "Gemini quota",
    }),
  };
  serve(server);

  await speak("Guten Tag!", "de");
  await speak("Guten Tag!", "de");
  await speak("Guten Tag!", "de");

  assert.equal(server.calls, 1);
});

test("a cache hit still names the engine that actually spoke", async () => {
  useProvider("gemini");
  const server: Server = {
    calls: 0,
    reply: () => ({
      audioBase64: SILENCE,
      provider: "openai",
      model: "gpt-4o-mini-tts",
      fellBackFrom: "gemini",
    }),
  };
  serve(server);

  await speak("Guten Tag!", "de");
  await speak("Guten Tag!", "de");

  assert.equal(getTTSState().activeProvider, "openai");
  assert.equal(getTTSState().activeModel, "gpt-4o-mini-tts");
});

test("switching the chosen voice does not play the previous one back", async () => {
  useProvider("openai");
  const server: Server = {
    calls: 0,
    reply: () => ({ audioBase64: SILENCE, provider: "openai", model: "gpt-4o-mini-tts" }),
  };
  serve(server);

  saveLocalProfile({
    nativeLanguage: "ru", targetLanguage: "de", uiLanguage: "ru",
    readingMinutes: 0, booksStarted: 0, booksFinished: 0, savedItems: 0,
    ttsProvider: "openai", ttsVoices: { openai: "onyx" },
  } as never);
  await speak("Guten Tag!", "de");

  saveLocalProfile({
    nativeLanguage: "ru", targetLanguage: "de", uiLanguage: "ru",
    readingMinutes: 0, booksStarted: 0, booksFinished: 0, savedItems: 0,
    ttsProvider: "openai", ttsVoices: { openai: "nova" },
  } as never);
  await speak("Guten Tag!", "de");

  assert.equal(server.calls, 2);
});

// ─── Fetching ahead ──────────────────────────────────────────────────────────
//
// The same measure as above, from the other side: a prefetch is only worth
// having if the play it was meant to serve then costs nothing. One that fetches
// audio the play asks for again has doubled the bill to save nothing.

test("a line fetched ahead of time plays without asking again", async () => {
  useProvider("gemini");
  const server: Server = {
    calls: 0,
    reply: () => ({ audioBase64: SILENCE, provider: "gemini", model: "gemini-2.5-flash-preview-tts" }),
  };
  serve(server);

  await prefetchSpeech("Guten Tag!", "de");
  assert.equal(server.calls, 1);

  await speak("Guten Tag!", "de");
  assert.equal(server.calls, 1);
});

test("a play that catches a prefetch mid-flight joins it", async () => {
  useProvider("gemini");
  let calls = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  g.fetch = async () => {
    calls++;
    await held;
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  const prefetching = prefetchSpeech("Guten Tag!", "de");
  await settle();
  const playing = speak("Guten Tag!", "de");
  release?.();
  await Promise.all([prefetching, playing]);

  assert.equal(calls, 1);
});

test("simultaneous prefetches reserve the cache key before lookup", async () => {
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);
  const originalCaches = g.caches;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  g.caches = {
    open: async () => ({
      ...new FakeCache(),
      match: async (key: string) => {
        await held;
        return new FakeCache().match(key);
      },
      put: (key: string, response: FakeResponse) => new FakeCache().put(key, response),
    }),
  };
  try {
    const first = prefetchSpeech("Haus", "de", "noun-article");
    const second = prefetchSpeech("Haus", "de", "noun-article");
    release?.();
    await Promise.all([first, second]);
    assert.equal(server.calls, 1);
  } finally {
    g.caches = originalCaches;
  }
});

test("article-free recordings are reused only within their own cache scope", async () => {
  useProvider("gemini");
  const requests: Array<{ text: string; lang: string; cacheScope: string }> = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  await prefetchSpeech("Haus", "de", "noun-article");
  await speak("Haus", "de", undefined, undefined, "noun-article");
  await speak("Haus", "de", undefined, undefined, "noun-article");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].text, "Haus");
  assert.equal(requests[0].lang, "de");
  assert.equal(requests[0].cacheScope, "noun-article");

  await speak("Haus", "de");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].cacheScope, "default");
});

test("an article prompt does not switch to the browser voice after a provider error", async () => {
  useProvider("gemini");
  const originalSpeechSynthesis = g.speechSynthesis;
  let browserSpeechCalls = 0;
  g.speechSynthesis = { cancel() {}, speak() { browserSpeechCalls++; } };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: "Выбранный голос недоступен" }) });
  try {
    const playback = await speak("frei", "de", undefined, undefined, "noun-article");
    assert.equal(playback, null);
    assert.equal(browserSpeechCalls, 0);
    assert.equal(getLastTtsError(), "Выбранный голос недоступен");
    assert.equal(getTTSState().status, "idle");
  } finally {
    if (originalSpeechSynthesis === undefined) delete g.speechSynthesis;
    else g.speechSynthesis = originalSpeechSynthesis;
  }
});

test("re-voicing a noun replaces its scoped recording and then reuses it", async () => {
  useProvider("gemini");
  const requests: Array<{ text: string; lang: string; cacheScope: string; refresh?: boolean }> = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  await speak("frei", "de", undefined, undefined, "noun-article");
  await respeak("frei", "de", undefined, undefined, "noun-article");
  await speak("frei", "de", undefined, undefined, "noun-article");

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ text, lang, cacheScope, refresh }) => ({ text, lang, cacheScope, refresh })), [
    { text: "frei", lang: "de", cacheScope: "noun-article", refresh: undefined },
    { text: "frei", lang: "de", cacheScope: "noun-article", refresh: true },
  ]);
});

test("nothing is fetched ahead for a line already cached", async () => {
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);

  await speak("Guten Tag!", "de");
  await prefetchSpeech("Guten Tag!", "de");

  assert.equal(server.calls, 1);
});

test("the browser voice is never fetched ahead — there is nothing to fetch", async () => {
  useProvider("local");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE }) };
  serve(server);

  await prefetchSpeech("Guten Tag!", "de");

  assert.equal(server.calls, 0);
});

test("only the agreed depth is fetched ahead", async () => {
  useProvider("gemini");
  const asked: string[] = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body).text);
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  await prefetchSpeechAhead(["eins", "zwei", "drei", "vier", "fünf"], "de");

  assert.equal(asked.length, SPEECH_PREFETCH_AHEAD);
  assert.deepEqual(asked, ["eins", "zwei"].slice(0, SPEECH_PREFETCH_AHEAD));
});

test("the noun drill prefetches four recordings one at a time", async () => {
  useProvider("gemini");
  const asked: string[] = [];
  let requestsInFlight = 0;
  let peakRequestsInFlight = 0;
  g.fetch = async (_url: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body).text);
    requestsInFlight++;
    peakRequestsInFlight = Math.max(peakRequestsInFlight, requestsInFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    requestsInFlight--;
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  await prefetchSpeechAhead(["eins", "zwei", "drei", "vier", "fünf"], "de", "noun-article", 4);

  assert.deepEqual(asked, ["eins", "zwei", "drei", "vier"]);
  assert.equal(peakRequestsInFlight, 1);
});

test("prefetch paces itself under Gemini's 10-per-minute limit", async (t) => {
  useProvider("gemini");
  const asked: string[] = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body).text);
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  // Date is mocked alongside setTimeout: the limiter reads Date.now() to size
  // its wait, and ticking the clock without moving Date.now() with it would
  // have the limiter see almost no time passed and reschedule itself forever.
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const words = Array.from({ length: GEMINI_PREFETCH_RPM_BUDGET + 1 }, (_, i) => `wort${i}`);
  const done = prefetchSpeechAhead(words, "de", "default", words.length);

  // Nothing here waits on a real timer yet — every dispatch up to the budget
  // is pure microtask chaining — so flushing the microtask queue is enough.
  await flushMicrotasks();
  assert.equal(asked.length, GEMINI_PREFETCH_RPM_BUDGET, "the word past the budget should still be waiting");

  t.mock.timers.tick(60_100);
  await flushMicrotasks();
  await done;

  assert.equal(asked.length, GEMINI_PREFETCH_RPM_BUDGET + 1);
});

test("an on-demand play never waits behind the prefetch pacing queue", async (t) => {
  useProvider("gemini");
  const asked: string[] = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body).text);
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  t.mock.timers.enable({ apis: ["setTimeout"] });

  // Exhaust the per-minute budget with background prefetches, without waiting
  // for the one behind it.
  const words = Array.from({ length: GEMINI_PREFETCH_RPM_BUDGET }, (_, i) => `wort${i}`);
  void prefetchSpeechAhead(words, "de", "default", words.length);
  await flushMicrotasks();
  assert.equal(asked.length, GEMINI_PREFETCH_RPM_BUDGET);

  // The word the learner is looking at right now must still speak at once —
  // pacing is for background work, never for what is on screen.
  await speak("Jetzt", "de");
  assert.ok(asked.includes("Jetzt"));
});

test("a prefetch that fails does not caption the card played next", async () => {
  // `lastTtsError` explains the voice coming out of the speaker right now. A
  // request made ahead of time is not about anything the learner is hearing, so
  // its failure belongs in the console, not under the next card they play.
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);
  await speak("Guten Tag!", "de");
  assert.equal(getLastTtsError(), null);

  g.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: "Квота исчерпана" }) });
  await prefetchSpeech("Gute Nacht!", "de");

  assert.equal(getLastTtsError(), null);
});

// ─── Expiring what the old instructions produced ─────────────────────────────

/** Put audio in the cache directly, the way an older version of the app would. */
function seedCache(key: string) {
  cacheStore.set(key, { body: SILENCE, headers: new Map([["X-Sample-Rate", "24000"]]) });
}

test("a recording made before the engine was told anything is not served", async () => {
  // Gemini used to be handed the bare word with no direction, so those
  // recordings are in whichever language it guessed and may act the word out
  // rather than say it. Playing them back would be playing back the bug.
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);

  seedCache("tts-gemini-Algenib-de-Guten%20Tag!");
  await speak("Guten Tag!", "de");

  assert.equal(server.calls, 1);
});

test("an engine that takes no direction keeps the recordings it had", async () => {
  // Deepgram picks its voice by language from a field, so nothing about what it
  // says changed. Expiring its cache would spend quota on identical audio.
  useProvider("deepgram");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "deepgram" }) };
  serve(server);

  seedCache("tts-deepgram-aura-2-julius-de-de-Guten%20Tag!");
  await speak("Guten Tag!", "de");

  assert.equal(server.calls, 0);
});

// ─── Replacing a recording that came out wrong ───────────────────────────────
//
// Caching is what makes a bad reading permanent rather than momentary: it is
// kept the instant it is made, and every later press is answered from the copy.
// So the test of a re-record is not that it plays something — it is that the
// old copy is gone.

test("a re-record ignores the cached copy and asks again", async () => {
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);

  await speak("lacht", "de");
  await speak("lacht", "de");
  assert.equal(server.calls, 1);

  await respeak("lacht", "de");
  assert.equal(server.calls, 2);
});

test("a re-record tells the server to skip its cache too", async () => {
  // Discarding only the browser's copy would fetch the same bad recording back
  // out of the shared one, and nothing would appear to have happened.
  useProvider("gemini");
  const bodies: Record<string, unknown>[] = [];
  g.fetch = async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  };

  await speak("lacht", "de");
  await respeak("lacht", "de");

  assert.equal(bodies[0].refresh, undefined);
  assert.equal(bodies[1].refresh, true);
});

test("a re-record that fails still leaves the bad recording gone", async () => {
  // The old copy goes before the new one is asked for, so a re-record that ends
  // in the browser voice cannot quietly restore what it was meant to replace.
  useProvider("gemini");
  const server: Server = { calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) };
  serve(server);
  await speak("lacht", "de");
  assert.equal(server.calls, 1);

  g.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: "нет" }) });
  await respeak("lacht", "de");

  serve(server);
  await speak("lacht", "de");
  assert.equal(server.calls, 2);
});

test("the player is told which language to ask for again in", async () => {
  // The re-record control lives in the player, which knows only what the state
  // carries — so the language has to be part of it.
  useProvider("gemini");
  serve({ calls: 0, reply: () => ({ audioBase64: SILENCE, provider: "gemini" }) });

  await speak("lacht", "de");

  assert.equal(getTTSState().text, "lacht");
  assert.equal(getTTSState().lang, "de");
});

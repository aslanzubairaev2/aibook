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

const { speak } = await import("./tts.ts");
const { saveLocalProfile } = await import("./db/local.ts");

function useProvider(ttsProvider: string) {
  cacheStore.clear();
  localStore.clear();
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
  const { getTTSState } = await import("./tts.ts");
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

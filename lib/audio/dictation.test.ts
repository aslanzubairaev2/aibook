import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTATION_MAX_BYTES, DICTATION_MODEL, dictationSeconds, dictationVocabulary, encodeDictationWav } from "./dictation.ts";
import { POST } from "../../app/api/ai/transcribe/route.ts";

function request(options: { key?: boolean; audio?: ArrayBuffer; mime?: string; length?: string } = {}) {
  const form = new FormData();
  form.set("audio", new Blob([options.audio ?? encodeDictationWav(new Float32Array(16000))], { type: options.mime ?? "audio/wav" }), "dictation.wav");
  form.set("context", "Почему denkst du an? denkst aufsehen");
  const headers: Record<string, string> = options.key === false ? {} : { "x-gemini-key": "test-only-key" };
  if (options.length) headers["content-length"] = options.length;
  return new Request("https://aibook.test/api/ai/transcribe", { method: "POST", body: form, headers });
}

test("canonical WAV: length, mono 16k, clipping, 60-second boundary", () => {
  const wav = encodeDictationWav(new Float32Array([2, -2, 0]));
  const view = new DataView(wav);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(dictationSeconds(wav), 3 / 16000);
  assert.equal(dictationSeconds(encodeDictationWav(new Float32Array(960000))), 60);
  assert.throws(() => dictationSeconds(encodeDictationWav(new Float32Array(960001))));
  view.setUint32(24, 48000, true);
  assert.throws(() => dictationSeconds(wav));
  assert.throws(() => dictationSeconds(new ArrayBuffer(10)));
});

test("vocabulary deduplicates and bounds mixed-language context", () => {
  assert.deepEqual(dictationVocabulary("Почему denkst du an? denkst"), ["Почему", "denkst", "du", "an"]);
  assert.equal(dictationVocabulary(Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ")).length, 80);
});

test("invalid audio, oversize bodies and denied access never reach Google", async t => {
  const previousEnv = process.env;
  process.env = { ...previousEnv, NODE_ENV: "production" };
  t.after(() => { process.env = previousEnv; });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call provider"); });
  for (const [req, status] of [
    [request({ key: false }), 403],
    [request({ mime: "audio/webm" }), 400],
    [request({ audio: new ArrayBuffer(50) }), 400],
    [request({ audio: encodeDictationWav(new Float32Array(10)) }), 400],
    [request({ length: String(DICTATION_MAX_BYTES + 20000) }), 413],
  ] as const) assert.equal((await POST(req)).status, status);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("one inline, non-stored request; language auto-detection, verbatim, vocabulary, draft text", async t => {
  const provider = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, DICTATION_MODEL);
    assert.equal(body.store, false);
    assert.equal(body.previous_interaction_id, undefined);
    assert.equal(body.input.length, 1);
    assert.equal(body.input[0].type, "audio");
    assert.equal(body.input[0].mime_type, "audio/wav");
    assert.equal(Buffer.from(body.input[0].data, "base64").length, 32044);
    assert.deepEqual(body.generation_config.transcription_config.language_codes, []);
    assert.equal(body.generation_config.transcription_config.mode.type, "verbatim");
    assert.ok(body.generation_config.transcription_config.custom_vocabulary.includes("aufsehen"));
    assert.ok(init?.signal);
    return Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Почему denkst du an?" }] }] });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).text, "Почему denkst du an?");
  assert.equal(provider.mock.callCount(), 1);
});

for (const [providerStatus, appStatus] of [[429, 429], [403, 422], [404, 422], [500, 502]]) {
  test(`provider ${providerStatus}: friendly error, no retry`, async t => {
    const provider = t.mock.method(globalThis, "fetch", async () => new Response("private upstream details", { status: providerStatus }));
    const response = await POST(request());
    assert.equal(response.status, appStatus);
    assert.doesNotMatch(await response.text(), /private upstream/);
    assert.equal(provider.mock.callCount(), 1);
  });
}

test("empty speech and incomplete response are visible errors", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ status: "completed" }));
  assert.equal((await POST(request())).status, 422);
  provider.mock.mockImplementation(async () => Response.json({ status: "in_progress" }));
  assert.equal((await POST(request())).status, 502);
});

test("network failure is not retried", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  assert.equal((await POST(request())).status, 504);
  assert.equal(provider.mock.callCount(), 1);
});

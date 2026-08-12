// Runs the real lesson pipeline against a stand-in Gemini endpoint, replying
// the way the service actually replies when things go wrong.
//
// Every case here was a "не удалось разобрать ответ ИИ" in production.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startFakeGeminiServer, type FakeGeminiServer } from "./fakeGeminiServer.ts";
import { parseModelJson } from "./jsonResponse.ts";

const PAGE = {
  title: "Mietvertrag",
  description: "Договор аренды квартиры.",
  paragraphs: [
    "Der Vermieter vermietet dem Mieter die Wohnung im zweiten Obergeschoss.",
    "Die Miete beträgt 850 Euro monatlich und ist bis zum dritten Werktag zu zahlen.",
    "Die Kaution beträgt zwei Monatsmieten.",
  ],
  vocabulary: [
    { term: "der Vermieter", translation: "арендодатель" },
    { term: "die Kaution", translation: "залог" },
  ],
  questions: [],
};

const EXTRACTED = {
  language: "de",
  languages: ["de"],
  isStudyMaterial: false,
  kind: "страница договора",
  text: "Der Vermieter vermietet dem Mieter die Wohnung.",
};

describe("salvaging a model answer", () => {
  test("plain JSON parses", () => {
    const r = parseModelJson(JSON.stringify(PAGE));
    assert.equal(r.ok && r.repaired, false);
  });

  test("a ```json fence is stripped", () => {
    const r = parseModelJson("```json\n" + JSON.stringify(PAGE) + "\n```");
    assert.ok(r.ok);
    assert.deepEqual((r.value as typeof PAGE).paragraphs, PAGE.paragraphs);
  });

  test("prose around the JSON is ignored", () => {
    const r = parseModelJson(`Sure! Here you go:\n${JSON.stringify(PAGE)}\nHope that helps.`);
    assert.ok(r.ok);
    assert.equal((r.value as typeof PAGE).title, "Mietvertrag");
  });

  test("an answer cut off mid-string keeps every complete paragraph", () => {
    const full = JSON.stringify(PAGE);
    const cut = full.slice(0, full.indexOf("Die Kaution") + 6);
    const r = parseModelJson(cut);
    assert.ok(r.ok, "a truncated answer must not be thrown away");
    assert.equal(r.repaired, true);
    const value = r.value as { paragraphs: string[] };
    assert.ok(value.paragraphs.length >= 2, "the paragraphs that did arrive survive");
    assert.equal(value.paragraphs[0], PAGE.paragraphs[0]);
  });

  test("an answer cut off between fields still parses", () => {
    const full = JSON.stringify(PAGE);
    const r = parseModelJson(full.slice(0, full.indexOf('"vocabulary"')));
    assert.ok(r.ok);
    assert.equal(r.repaired, true);
    assert.equal((r.value as { title: string }).title, "Mietvertrag");
  });

  test("genuinely empty or unusable answers are rejected, not invented", () => {
    for (const bad of ["", "   ", "I cannot read this image."]) {
      assert.equal(parseModelJson(bad).ok, false, `should reject: ${JSON.stringify(bad)}`);
    }
  });
});

describe("the lesson pipeline against a stand-in Gemini", () => {
  let server: FakeGeminiServer;
  let runImagePrompt: typeof import("./lessonModel.ts").runImagePrompt;
  let runLessonPrompt: typeof import("./lessonModel.ts").runLessonPrompt;

  before(async () => {
    server = await startFakeGeminiServer();
    // The module reads the base URL once, at import time.
    process.env.GEMINI_API_BASE_URL = server.baseUrl;
    ({ runImagePrompt, runLessonPrompt } = await import("./lessonModel.ts"));
  });

  after(async () => {
    delete process.env.GEMINI_API_BASE_URL;
    await server.close();
  });

  test("a photo is read, and thinking is switched off so the budget goes to the answer", async () => {
    server.queue({ kind: "json", value: EXTRACTED });
    const result = await runImagePrompt("k", "read this", "aGVsbG8=", "image/jpeg");

    assert.ok(result.ok, `expected success, got: ${!result.ok && result.error}`);
    assert.equal((result.data as typeof EXTRACTED).language, "de");

    const body = server.requests.at(-1)!.body as { generationConfig?: Record<string, unknown> };
    const config = body.generationConfig ?? {};
    assert.deepEqual(
      config.thinkingConfig,
      { thinkingBudget: 0 },
      "transcription must not spend the output budget on thinking — that is what truncated the answer",
    );
    assert.ok(
      (config.maxOutputTokens as number) >= 16384,
      "a full page needs room; 4096 was the ceiling that cut answers off",
    );
    assert.ok(config.responseSchema, "the response shape is declared, not merely requested");
  });

  test("a truncated page is recovered instead of reported as unreadable", async () => {
    const full = JSON.stringify(EXTRACTED);
    server.queue({ kind: "truncated", value: EXTRACTED, keep: full.indexOf("Wohnung") });

    const result = await runImagePrompt("k", "read this", "aGVsbG8=", "image/jpeg");
    assert.ok(result.ok, "the transcription that did arrive is worth keeping");
    assert.equal(result.truncated, true, "and the caller is told it was cut short");
  });

  test("a fenced answer is accepted", async () => {
    server.queue({ kind: "fenced", value: EXTRACTED });
    const result = await runImagePrompt("k", "read this", "aGVsbG8=", "image/jpeg");
    assert.ok(result.ok);
  });

  test("an empty answer says the answer was empty, not that JSON was invalid", async () => {
    server.queue({ kind: "emptyMaxTokens" });
    const result = await runImagePrompt("k", "read this", "aGVsbG8=", "image/jpeg");
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /не поместился|пустой/i);
  });

  test("a safety block is named as one", async () => {
    server.queue({ kind: "safetyBlock" });
    const result = await runImagePrompt("k", "read this", "aGVsbG8=", "image/jpeg");
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /фильтр/i);
    assert.equal((result as { status: number }).status, 422);
  });

  test("a quota error is named as one, in Russian, and is not retried", async () => {
    const before = server.requests.length;
    server.queue({ kind: "httpError", status: 429, message: "Resource has been exhausted" });

    const result = await runLessonPrompt("k", "write a lesson", { faithful: true });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 429);
    assert.match((result as { error: string }).error, /квота/i);
    assert.equal(server.requests.length - before, 1, "retrying a quota refusal only doubles the wait");
  });

  test("a malformed answer is retried once, and the retry is used", async () => {
    const fresh = await startFakeGeminiServer([
      { kind: "chatty", value: { nonsense: true } },
      { kind: "json", value: PAGE },
    ]);
    process.env.GEMINI_API_BASE_URL = fresh.baseUrl;
    const mod = await import(`./lessonModel.ts?retry=${Date.now()}`);

    const result = await mod.runLessonPrompt("k", "write a lesson", { faithful: true });
    assert.ok(result.ok, `expected the retry to succeed, got: ${!result.ok && result.error}`);
    assert.equal(result.lesson.title, "Mietvertrag");
    assert.equal(fresh.requests.length, 2, "exactly one retry");

    await fresh.close();
    process.env.GEMINI_API_BASE_URL = server.baseUrl;
  });

  test("a one-paragraph document is a lesson, not a failure", async () => {
    const fresh = await startFakeGeminiServer([
      { kind: "json", value: { title: "Ausgang", paragraphs: ["Notausgang bitte freihalten."], vocabulary: [], questions: [] } },
    ]);
    process.env.GEMINI_API_BASE_URL = fresh.baseUrl;
    const mod = await import(`./lessonModel.ts?single=${Date.now()}`);

    const result = await mod.runLessonPrompt("k", "restore this sign", { faithful: true });
    assert.ok(result.ok, "a photographed sign has exactly one paragraph");
    assert.deepEqual(result.lesson.paragraphs, ["Notausgang bitte freihalten."]);

    await fresh.close();
    process.env.GEMINI_API_BASE_URL = server.baseUrl;
  });
});

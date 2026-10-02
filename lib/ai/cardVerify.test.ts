import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardVerifyPrompt, normalizeVerifyResult, sanitizeVerifyRequest } from "./cardVerify.ts";
import { buildAnalysisPrompt } from "./buildAnalysisPrompt.ts";

const current = { front: "die Stelle", back: "ставлю\nмн. ч.: die Stellen" };

test("sanitizing refuses a card with an empty side", () => {
  assert.equal(sanitizeVerifyRequest({ card: { front: "die Stelle", back: "  " } }), null);
  assert.equal(sanitizeVerifyRequest({ card: { front: "", back: "место" } }), null);
  assert.equal(sanitizeVerifyRequest(null), null);
});

test("sanitizing keeps the dictionary entry and only answered clarifications", () => {
  const request = sanitizeVerifyRequest({
    card: { type: "word", front: "die Stelle", back: "место", cefr: "A1", source: "Pack" },
    entry: { headword: "die Stelle", lemma: "Stelle", translation: "место", partOfSpeech: "существительное", forms: { a: "b", empty: "" } },
    clarifications: [{ question: "Какое значение?", answer: "вакансия" }, { question: "без ответа", answer: "" }],
  });
  assert.ok(request);
  assert.equal(request.entry?.partOfSpeech, "существительное");
  assert.deepEqual(request.entry?.forms, { a: "b" });
  assert.equal(request.clarifications.length, 1);
});

test("the prompt carries the whole card and forbids guessing", () => {
  const request = sanitizeVerifyRequest({
    card: { type: "word", front: "die Stelle", back: "ставлю", cefr: "A1", source: "Pack A" },
    entry: { headword: "die Stelle", translation: "место, вакансия", partOfSpeech: "существительное" },
    clarifications: [{ question: "Какое значение?", answer: "вакансия" }],
    nativeLanguage: "ru",
    targetLanguage: "de",
  });
  assert.ok(request);
  const prompt = buildCardVerifyPrompt(request);
  for (const fragment of ["die Stelle", "ставлю", "Pack A", "место, вакансия", "существительное", "A: вакансия"]) {
    assert.ok(prompt.includes(fragment), `missing ${fragment}`);
  }
  assert.match(prompt, /do not guess/i);
  assert.match(prompt, /"question"/);
});

test("a question verdict needs an actual question", () => {
  assert.deepEqual(normalizeVerifyResult({ verdict: "question", question: " Что имеется в виду? " }, current),
    { verdict: "question", question: "Что имеется в виду?" });
  assert.equal(normalizeVerifyResult({ verdict: "question", question: "" }, current), null);
});

test("a fix returns the corrected card and its changes", () => {
  const result = normalizeVerifyResult({
    verdict: "fix",
    front: "die Stelle",
    back: "место, вакансия\nмн. ч.: die Stellen",
    changes: ["ставлю → место, вакансия", ""],
    note: "",
  }, current);
  assert.deepEqual(result, {
    verdict: "fix",
    front: "die Stelle",
    back: "место, вакансия\nмн. ч.: die Stellen",
    changes: ["ставлю → место, вакансия"],
    note: "",
  });
});

test("a fix that changes nothing is reported as ok", () => {
  const result = normalizeVerifyResult({ verdict: "fix", front: "die  Stelle", back: current.back, changes: ["x"] }, current);
  assert.equal(result?.verdict, "ok");
});

test("a fix may never blank a side of the card", () => {
  assert.equal(normalizeVerifyResult({ verdict: "fix", front: "die Stelle", back: "" }, current), null);
  assert.equal(normalizeVerifyResult({ verdict: "fix", front: "", back: "место" }, current), null);
});

test("the word null in a field means empty", () => {
  assert.equal(normalizeVerifyResult({ verdict: "question", question: "null" }, current), null);
  assert.deepEqual(normalizeVerifyResult({ verdict: "ok", note: "none" }, current), { verdict: "ok", note: "" });
});

test("an unknown verdict is rejected", () => {
  assert.equal(normalizeVerifyResult({ verdict: "maybe" }, current), null);
  assert.equal(normalizeVerifyResult("ok", current), null);
});

test("word analysis from a card pins the reading to the card", () => {
  const prompt = buildAnalysisPrompt({
    mode: "word",
    word: "stelle",
    sentence: "die Stelle",
    sentenceBefore: "",
    sentenceAfter: "",
    cardContext: { front: "die Stelle", back: "место, вакансия\nмн. ч.: die Stellen" },
    nativeLanguage: "ru",
    targetLanguage: "de",
  });
  assert.match(prompt, /flashcard/);
  assert.match(prompt, /Front: "die Stelle"/);
  assert.match(prompt, /Meaning on the back: "место, вакансия"/);
});

test("word analysis without a card has no card instructions", () => {
  const prompt = buildAnalysisPrompt({
    mode: "word",
    word: "stelle",
    sentence: "Ich stelle das Glas auf den Tisch.",
    sentenceBefore: "",
    sentenceAfter: "",
    nativeLanguage: "ru",
    targetLanguage: "de",
  });
  assert.doesNotMatch(prompt, /flashcard/);
});

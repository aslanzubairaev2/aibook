import assert from "node:assert/strict";
import test from "node:test";
import { buildFastWordPrompt, normalizeFastWordInfo, parseFastWordJson } from "./fastWord.ts";

test("fast prompt explicitly excludes full analysis material", () => {
  const prompt = buildFastWordPrompt({
    word: "verdienen",
    sentence: "Sie verdienen nicht genug Geld.",
    nativeLanguage: "Russian",
    targetLanguage: "German",
  });
  assert.match(prompt, /Return ONLY compact JSON/);
  assert.match(prompt, /exactly three verbForms/);
  assert.doesNotMatch(prompt, /examples.*required/i);
});

test("normalizes verb principal forms", () => {
  const result = normalizeFastWordInfo({
    word: "verdienen",
    translation: "зарабатывать",
    partOfSpeech: "verb",
    verbForms: ["verdienen", "verdiente", "verdient"],
    article: "der",
  }, "verdienen");
  assert.deepEqual(result.verbForms, ["verdienen", "verdiente", "verdient"]);
  assert.equal(result.article, undefined);
});

test("normalizes noun article and plural", () => {
  const result = parseFastWordJson(
    "{\"word\":\"Kuh\",\"translation\":\"корова\",\"partOfSpeech\":\"noun\",\"article\":\"die\",\"plural\":\"Kühe\"}",
    "Kuh",
  );
  assert.equal(result.article, "die");
  assert.equal(result.plural, "Kühe");
});

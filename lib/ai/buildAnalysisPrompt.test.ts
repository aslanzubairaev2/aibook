import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisPrompt } from "./buildAnalysisPrompt.ts";

test("word prompt delegates separable-verb disambiguation to the model", () => {
  const prompt = buildAnalysisPrompt({
    mode: "word",
    word: "kauft",
    sentence: "Er kauft das Buch auf dem Tisch.",
    sentenceBefore: "Am Morgen geht er zur Arbeit.",
    sentenceAfter: "Danach liest er es.",
    nativeLanguage: "Russian",
    targetLanguage: "German",
  });

  assert.match(prompt, /separability/);
  assert.match(prompt, /exactly yes, no, or unknown/);
  assert.match(prompt, /nearby particle/);
  assert.match(prompt, /Previous sentence for context/);
  assert.match(prompt, /Next sentence for context/);
});

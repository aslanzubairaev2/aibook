import test from "node:test";
import assert from "node:assert/strict";
import { hasQuickWordForms, quickWordForms } from "./quickWordForms.ts";
import { buildAnalysisPrompt } from "./buildAnalysisPrompt.ts";
import type { WordAnalysis } from "../types.ts";

const base: WordAnalysis = { text: "sitzt", lemma: "sitzen", translation: "сидеть", partOfSpeech: "глагол", posTag: "verb" };

test("verb preview uses exactly the three principal parts without labels", () => {
  const word = { ...base, verbDetails: { infinitive: "sitzen", praeteritum: "saß", partizip2: "gesessen", tense: "Präsens", person: "er" } };
  assert.equal(quickWordForms(word), "sitzen - saß - gesessen");
  assert.equal(hasQuickWordForms(word), true);
});

test("old cached verbs require enrichment; complete entries do not", () => {
  assert.equal(hasQuickWordForms({ ...base, verbDetails: { infinitive: "sitzen" } }), false);
});

test("nouns show nominative singular and plural even when clicked in plural", () => {
  const noun: WordAnalysis = { ...base, text: "Häusern", lemma: "Haus", posTag: "noun", partOfSpeech: "существительное", nounDetails: { singular: "das Haus", plural: "die Häuser" } };
  assert.equal(quickWordForms(noun), "das Haus - die Häuser");
  assert.equal(hasQuickWordForms(noun), true);
  assert.equal(hasQuickWordForms({ ...noun, nounDetails: { plural: "Häuser" } }), false);
});

test("non-verbs with empty verbDetails never show irrelevant grammar", () => {
  const word: WordAnalysis = { ...base, posTag: "adverb", verbDetails: { infinitive: "", tense: "", person: "" } };
  assert.equal(quickWordForms(word), "");
  assert.equal(hasQuickWordForms(word), true);
  assert.equal(quickWordForms(undefined), "");
});

test("analysis requests bare past participle and both noun numbers", () => {
  const prompt = buildAnalysisPrompt({ mode: "word", word: "sitzen", sentence: "Wir sitzen hier.", sentenceBefore: "", sentenceAfter: "", nativeLanguage: "ru", targetLanguage: "de" });
  assert.match(prompt, /praeteritum/);
  assert.match(prompt, /WITHOUT auxiliary or pronoun/);
  assert.match(prompt, /nominative singular/);
  assert.match(prompt, /nominative plural/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailableTtsProviders,
  getSpeechifyLocale,
  getSpeechifyModel,
  isSpeechifyTtsSupported,
  getTtsProviderLabel,
} from "./ttsProviders.ts";

test("picks Simba 3.0 for the languages it covers", () => {
  // Simba 3.2 is English-only, so the German deck must not be routed to it.
  for (const lang of ["de", "de-DE", "en", "es", "fr", "it", "pt"]) {
    assert.equal(getSpeechifyModel(lang), "simba-3.0", lang);
  }
});

test("falls to Simba Multilingual outside the Simba 3.0 set", () => {
  for (const lang of ["ru", "ja", "pl", "tr", "zh"]) {
    assert.equal(getSpeechifyModel(lang), "simba-multilingual", lang);
  }
});

test("expands a bare language code into the locale Speechify wants", () => {
  assert.equal(getSpeechifyLocale("de"), "de-DE");
  assert.equal(getSpeechifyLocale("DE"), "de-DE");
  assert.equal(getSpeechifyLocale("pt"), "pt-BR");
});

test("keeps a caller's explicit locale rather than flattening it", () => {
  // "de-AT" would otherwise become "de-DE" and lose the Austrian voice.
  assert.equal(getSpeechifyLocale("de-AT"), "de-AT");
  assert.equal(getSpeechifyLocale("es-MX"), "es-MX");
});

test("reports no support for a language with no locale mapping", () => {
  assert.equal(getSpeechifyLocale("xx"), null);
  assert.equal(isSpeechifyTtsSupported("xx"), false);
  assert.equal(isSpeechifyTtsSupported("de"), true);
});

test("offers Speechify for German alongside the other voices", () => {
  const german = getAvailableTtsProviders("de");
  assert.deepEqual(german, ["local", "gemini", "deepgram", "speechify"]);

  // Polish has a Speechify locale but no Deepgram voice.
  const polish = getAvailableTtsProviders("pl");
  assert.deepEqual(polish, ["local", "gemini", "speechify"]);

  // A language neither provider knows leaves only the browser and Gemini.
  assert.deepEqual(getAvailableTtsProviders("xx"), ["local", "gemini"]);
});

test("labels the new provider", () => {
  assert.equal(getTtsProviderLabel("speechify"), "Speechify Simba");
});

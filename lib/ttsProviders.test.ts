import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailableTtsProviders,
  getBcp47Locale,
  getSpeechifyLocale,
  getSpeechifyModel,
  isInworldTtsSupported,
  isSpeechifyTtsSupported,
  getTtsProviderLabel,
  getTtsProviderChain,
  getInworldAuthorizationHeader,
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

test("offers every voice that can speak German", () => {
  assert.deepEqual(getAvailableTtsProviders("de"), ["local", "gemini", "deepgram", "speechify", "inworld"]);

  // Polish has a locale for the paid voices but no Deepgram model.
  assert.deepEqual(getAvailableTtsProviders("pl"), ["local", "gemini", "speechify", "inworld"]);

  // A language with no locale mapping leaves only the browser and Gemini.
  assert.deepEqual(getAvailableTtsProviders("xx"), ["local", "gemini"]);
});

test("labels the new providers", () => {
  assert.equal(getTtsProviderLabel("speechify"), "Speechify Simba");
  assert.equal(getTtsProviderLabel("inworld"), "Inworld TTS");
});

test("Inworld takes the same locale tags, since one voice covers many languages", () => {
  assert.equal(isInworldTtsSupported("de"), true);
  assert.equal(isInworldTtsSupported("ru"), true);
  assert.equal(isInworldTtsSupported("xx"), false);
  assert.equal(getBcp47Locale("de"), "de-DE");
});

test("builds the automatic Gemini fallback chain", () => {
  assert.deepEqual(getTtsProviderChain(undefined, "de"), ["gemini", "speechify", "inworld"]);
  assert.deepEqual(getTtsProviderChain("gemini", "xx"), ["gemini"]);
  assert.deepEqual(getTtsProviderChain("speechify", "de"), ["speechify"]);
});

test("normalizes a missing provider to Gemini", () => {
  assert.equal(getTtsProviderChain(undefined, "de")[0], "gemini");
});

test("accepts both supported Inworld key shapes", () => {
  assert.equal(getInworldAuthorizationHeader("abc123"), "Basic abc123");
  assert.equal(getInworldAuthorizationHeader(" Basic abc123 "), "Basic abc123");
});

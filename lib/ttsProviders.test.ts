import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailableTtsProviders,
  getBcp47Locale,
  getSpeechifyLocale,
  getSpeechifyModel,
  isCartesiaTtsSupported,
  isCartesiaVoiceId,
  isInworldTtsSupported,
  isOpenAiTtsSupported,
  isSpeechifyTtsSupported,
  getTtsProviderLabel,
  getTtsProviderChain,
  getInworldAuthorizationHeader,
  normalizeOpenAiVoice,
  normalizeTtsProvider,
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

test("offers every voice that can speak German, best first", () => {
  assert.deepEqual(
    getAvailableTtsProviders("de"),
    ["local", "gemini", "openai", "cartesia", "deepgram", "speechify", "inworld"],
  );

  // Polish has a locale for the paid voices but no Deepgram model.
  assert.deepEqual(
    getAvailableTtsProviders("pl"),
    ["local", "gemini", "openai", "cartesia", "speechify", "inworld"],
  );

  // Greek is outside Sonic 2's language list but still has a Speechify locale.
  assert.deepEqual(getAvailableTtsProviders("el"), ["local", "gemini", "openai", "speechify", "inworld"]);

  // A language with no locale mapping leaves the browser, Gemini, and GPT-4o —
  // the last of which reads the language off the text and so never opts out.
  assert.deepEqual(getAvailableTtsProviders("xx"), ["local", "gemini", "openai"]);
});

test("labels the new providers", () => {
  assert.equal(getTtsProviderLabel("speechify"), "Speechify Simba");
  assert.equal(getTtsProviderLabel("inworld"), "Inworld TTS");
  assert.equal(getTtsProviderLabel("openai"), "OpenAI GPT-4o");
  assert.equal(getTtsProviderLabel("cartesia"), "Cartesia Sonic");
});

test("Sonic 2 speaks its own list of languages and no others", () => {
  for (const lang of ["de", "ru", "ja", "pl", "sv"]) {
    assert.equal(isCartesiaTtsSupported(lang), true, lang);
  }
  // Greek, Hebrew and the rest are outside Sonic 2's list.
  for (const lang of ["el", "he", "uk", "xx"]) {
    assert.equal(isCartesiaTtsSupported(lang), false, lang);
  }
});

test("tells a Cartesia voice id from a voice name", () => {
  assert.equal(isCartesiaVoiceId("a0e99841-438c-4a64-b679-ae501e7d6091"), true);
  // The library shows names; those need looking up before they can be used.
  assert.equal(isCartesiaVoiceId("Jameson"), false);
  assert.equal(isCartesiaVoiceId(""), false);
});

test("GPT-4o needs no locale, so it speaks every language", () => {
  for (const lang of ["de", "ru", "zh", "xx"]) {
    assert.equal(isOpenAiTtsSupported(lang), true, lang);
  }
});

test("takes an OpenAI voice in the casing the playground shows it", () => {
  // The playground lists "Ash"; the API accepts only "ash" and 400s otherwise.
  assert.equal(normalizeOpenAiVoice("Ash"), "ash");
  assert.equal(normalizeOpenAiVoice(" ALLOY "), "alloy");
  assert.equal(normalizeOpenAiVoice("onyx"), "onyx");
  // Not a voice at all: leave it be, so OpenAI's own message explains it.
  assert.equal(normalizeOpenAiVoice("Matthias"), "Matthias");
});

test("accepts the names a learner might type for GPT-4o", () => {
  for (const alias of ["openai", "gpt", "gpt-4o", "GPT_4o", " OpenAI "]) {
    assert.equal(normalizeTtsProvider(alias), "openai", alias);
  }
});

test("Inworld takes the same locale tags, since one voice covers many languages", () => {
  assert.equal(isInworldTtsSupported("de"), true);
  assert.equal(isInworldTtsSupported("ru"), true);
  assert.equal(isInworldTtsSupported("xx"), false);
  assert.equal(getBcp47Locale("de"), "de-DE");
});

test("builds the automatic Gemini fallback chain in preference order", () => {
  assert.deepEqual(
    getTtsProviderChain(undefined, "de"),
    ["gemini", "openai", "cartesia", "speechify", "inworld"],
  );
  // Even with no locale mapping, GPT-4o can still answer for Gemini.
  assert.deepEqual(getTtsProviderChain("gemini", "xx"), ["gemini", "openai"]);
  assert.deepEqual(getTtsProviderChain("speechify", "de"), ["speechify"]);
  assert.deepEqual(getTtsProviderChain("openai", "de"), ["openai"]);
  assert.deepEqual(getTtsProviderChain("cartesia", "de"), ["cartesia"]);
});

test("normalizes a missing provider to Gemini", () => {
  assert.equal(getTtsProviderChain(undefined, "de")[0], "gemini");
});

test("accepts both supported Inworld key shapes", () => {
  assert.equal(getInworldAuthorizationHeader("abc123"), "Basic abc123");
  assert.equal(getInworldAuthorizationHeader(" Basic abc123 "), "Basic abc123");
});

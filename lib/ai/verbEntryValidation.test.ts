import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDictionaryEntries } from "./buildDictionaryPrompt.ts";
import { normalizeGermanVerbEntry, validateGermanVerbEntries } from "./verbEntryValidation.ts";
import type { DictionaryEntryDraft } from "./buildDictionaryPrompt.ts";

function verb(overrides: Partial<DictionaryEntryDraft> = {}): DictionaryEntryDraft {
  return {
    headword: "machen",
    lemma: "machen",
    translation: "делать",
    partOfSpeech: "глагол",
    contentType: "word",
    gender: "",
    article: "",
    plural: "",
    forms: {},
    cefr: "A1",
    ...overrides,
  };
}

test("canonicalizes möchten to mögen and supplies authoritative modal forms", () => {
  const result = normalizeGermanVerbEntry(verb({ headword: "möchten", lemma: "möchten" }));
  assert.equal(result.headword, "mögen");
  assert.equal(result.lemma, "mögen");
  assert.deepEqual(result.forms, {
    praeteritum: "mochte",
    partizip2: "gemocht",
    hilfsverb: "haben",
    trennbar: "нет",
  });
});

test("authoritative special forms make tun complete without trusting model omissions", () => {
  const result = validateGermanVerbEntries([verb({ headword: "tun", lemma: "tun" })], "de");
  assert.deepEqual(result.invalidVerbs, []);
  assert.equal(result.entries[0].forms?.partizip2, "getan");
});

test("incomplete ordinary German verbs are rejected before persistence", () => {
  const result = validateGermanVerbEntries([verb({ headword: "warten", lemma: "warten" })], "de");
  assert.equal(result.entries.length, 1);
  assert.match(result.invalidVerbs[0], /warten/);
  assert.match(result.invalidVerbs[0], /praeteritum/);
  assert.match(result.invalidVerbs[0], /partizip2/);
});

test("image parser reports incomplete German verb rows instead of silently saving them", () => {
  const result = parseDictionaryEntries({
    entries: [verb({ headword: "warten", lemma: "warten" })],
  }, "de");
  assert.equal(result.entries.length, 1);
  assert.equal(result.invalidVerbs.length, 1);
});


import assert from "node:assert/strict";
import test from "node:test";
import { formatGovernment, germanVerbGovernment, knownGermanGovernment, parseGovernment } from "./verbGovernment.ts";
import { extractVerbFormsFromDetails, summarizeGermanVerb } from "./verbForms.ts";

test("government line reads prepositions, bare cases and hints", () => {
  assert.deepEqual(parseGovernment("mit + Dat (с кем); über + Akk (о чём)"), [
    { prep: "mit", case: "Dat", hint: "с кем" },
    { prep: "über", case: "Akk", hint: "о чём" },
  ]);
  assert.deepEqual(parseGovernment("Dat (кому); sich an + Akkusativ"), [
    { prep: null, case: "Dat", hint: "кому" },
    { prep: "sich an", case: "Akk", hint: "" },
  ]);
  assert.deepEqual(parseGovernment("ерунда; "), []);
  const line = "auf + Akk (кого/что)";
  assert.equal(formatGovernment(parseGovernment(line)), line);
});

test("a stored line wins, otherwise the curated one is used", () => {
  assert.equal(germanVerbGovernment("warten")[0]?.prep, "auf");
  assert.equal(germanVerbGovernment("sich freuen").length, 2);
  assert.deepEqual(germanVerbGovernment("warten", "Dat (кому)"), [{ prep: null, case: "Dat", hint: "кому" }]);
  assert.deepEqual(germanVerbGovernment("schlafen"), []);
  assert.equal(knownGermanGovernment("constructor"), "");
});

test("a card back's «управление» line feeds the verb summary", () => {
  const { forms, rest } = extractVerbFormsFromDetails(
    "Präteritum: wartete · Partizip II: gewartet · вспом. глагол: haben · управление: auf + Akk (кого/что)",
  );
  assert.equal(rest, "");
  assert.deepEqual(summarizeGermanVerb("warten", forms)?.government, [{ prep: "auf", case: "Akk", hint: "кого/что" }]);
});

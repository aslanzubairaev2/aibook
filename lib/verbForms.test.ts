import { strict as assert } from "node:assert";
import test from "node:test";

import {
  classifyGermanVerb,
  GERMAN_VERB_CLASS_HINT,
  GERMAN_VERB_CLASS_LABEL,
  isIrregularGermanVerb,
  isPresentPluralInfinitive,
} from "./verbForms";

test("ordinary verbs stay in the weak/standard group", () => {
  assert.equal(classifyGermanVerb("kosten", "kosten", { praeteritum: "kostete", partizip2: "gekostet" }), "weak");
  assert.equal(isIrregularGermanVerb("machen", "machen", { praeteritum: "machte", partizip2: "gemacht" }), false);
});

test("strong verbs are separated from the standard group", () => {
  assert.equal(classifyGermanVerb("backen", "backen", { praeteritum: "buk", partizip2: "gebacken" }), "strong");
  assert.equal(classifyGermanVerb("singen", "singen", { praeteritum: "sang", partizip2: "gesungen" }), "strong");
});

test("mixed verbs are their own memorisation group", () => {
  assert.equal(classifyGermanVerb("bringen", "bringen", { praeteritum: "brachte", partizip2: "gebracht" }), "mixed");
  assert.equal(classifyGermanVerb("mitbringen", "mitbringen", { praeteritum: "brachte mit", partizip2: "mitgebracht" }), "mixed");
});

test("special and impersonal verbs are not presented as ordinary strong verbs", () => {
  assert.equal(classifyGermanVerb("sein", "sein", { praeteritum: "war", partizip2: "gewesen" }), "special");
  assert.equal(classifyGermanVerb("regnen", "regnen", { praeteritum: "regnete", partizip2: "geregnet" }), "impersonal");
});

test("every learning group has a label and an explanation", () => {
  for (const type of ["weak", "strong", "mixed", "special", "impersonal"] as const) {
    assert.ok(GERMAN_VERB_CLASS_LABEL[type]);
    assert.ok(GERMAN_VERB_CLASS_HINT[type]);
  }
});

test("present plural forms can be supplied when they exactly repeat the infinitive", () => {
  assert.equal(isPresentPluralInfinitive("wir", "kosten", "kosten"), true);
  assert.equal(isPresentPluralInfinitive("sie/Sie", "fahren", "fahren"), true);
  assert.equal(isPresentPluralInfinitive("wir", "sind", "sein"), false);
  assert.equal(isPresentPluralInfinitive("ihr", "fahrt", "fahren"), false);
  assert.equal(isPresentPluralInfinitive("wir", "fuhren", "fahren"), false);
});

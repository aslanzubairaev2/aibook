import { strict as assert } from "node:assert";
import test from "node:test";

import { checkAgainstAlternatives, checkConjugationAnswer, conjugateGermanLocally, keyPersons } from "./verbConjugation.ts";

const weak = (lemma: string, praeteritum: string, partizip2: string, hilfsverb = "haben", trennbar?: string) =>
  ({ lemma, forms: { praeteritum, partizip2, hilfsverb, ...(trennbar ? { trennbar } : {}) } });

test("weak present follows the stem rules", () => {
  const cases: Array<[string, string, string, string[]]> = [
    ["machen", "machte", "gemacht", ["mache", "machst", "macht", "machen", "macht", "machen"]],
    ["arbeiten", "arbeitete", "gearbeitet", ["arbeite", "arbeitest", "arbeitet", "arbeiten", "arbeitet", "arbeiten"]],
    ["reden", "redete", "geredet", ["rede", "redest", "redet", "reden", "redet", "reden"]],
    ["öffnen", "öffnete", "geöffnet", ["öffne", "öffnest", "öffnet", "öffnen", "öffnet", "öffnen"]],
    ["rechnen", "rechnete", "gerechnet", ["rechne", "rechnest", "rechnet", "rechnen", "rechnet", "rechnen"]],
    ["atmen", "atmete", "geatmet", ["atme", "atmest", "atmet", "atmen", "atmet", "atmen"]],
    ["lernen", "lernte", "gelernt", ["lerne", "lernst", "lernt", "lernen", "lernt", "lernen"]],
    ["wohnen", "wohnte", "gewohnt", ["wohne", "wohnst", "wohnt", "wohnen", "wohnt", "wohnen"]],
    ["reisen", "reiste", "gereist", ["reise", "reist", "reist", "reisen", "reist", "reisen"]],
    ["tanzen", "tanzte", "getanzt", ["tanze", "tanzt", "tanzt", "tanzen", "tanzt", "tanzen"]],
    ["sammeln", "sammelte", "gesammelt", ["sammle", "sammelst", "sammelt", "sammeln", "sammelt", "sammeln"]],
    ["wandern", "wanderte", "gewandert", ["wandere", "wanderst", "wandert", "wandern", "wandert", "wandern"]],
  ];
  for (const [lemma, pr, p2, expected] of cases) {
    const v = weak(lemma, pr, p2);
    assert.deepEqual(conjugateGermanLocally(v.lemma, v.forms, "present", "weak"), expected, lemma);
  }
});

test("separable and reflexive verbs keep the particle and pronoun in place", () => {
  const einkaufen = weak("einkaufen", "kaufte ein", "eingekauft", "haben", "да");
  assert.deepEqual(conjugateGermanLocally(einkaufen.lemma, einkaufen.forms, "present", "weak"),
    ["kaufe ein", "kaufst ein", "kauft ein", "kaufen ein", "kauft ein", "kaufen ein"]);
  assert.deepEqual(conjugateGermanLocally(einkaufen.lemma, einkaufen.forms, "preteritum", "weak")?.[1], "kauftest ein");
  assert.deepEqual(conjugateGermanLocally(einkaufen.lemma, einkaufen.forms, "perfekt", "weak")?.[0], "habe eingekauft");
  assert.deepEqual(conjugateGermanLocally(einkaufen.lemma, einkaufen.forms, "future", "weak")?.[2], "wird einkaufen");

  const freuen = weak("sich freuen", "freute", "gefreut");
  assert.deepEqual(conjugateGermanLocally(freuen.lemma, freuen.forms, "present", "weak"),
    ["freue mich", "freust dich", "freut sich", "freuen uns", "freut euch", "freuen sich"]);
  assert.equal(conjugateGermanLocally(freuen.lemma, freuen.forms, "perfekt", "weak")?.[1], "hast dich gefreut");
  assert.equal(conjugateGermanLocally(freuen.lemma, freuen.forms, "future", "weak")?.[3], "werden uns freuen");
});

test("a separable verb whose stored past has no particle is left to the AI", () => {
  const v = weak("einkaufen", "kaufte", "eingekauft", "haben", "да");
  assert.equal(conjugateGermanLocally(v.lemma, v.forms, "present", "weak"), null);
});

test("strong present is never guessed", () => {
  const v = weak("fahren", "fuhr", "gefahren", "sein");
  assert.equal(conjugateGermanLocally(v.lemma, v.forms, "present", "strong"), null);
  assert.equal(conjugateGermanLocally("sein", { praeteritum: "war", partizip2: "gewesen", hilfsverb: "sein" }, "present", "special"), null);
});

test("Präteritum endings on weak, strong and special stems", () => {
  const cases: Array<[string, string, string[]]> = [
    ["fahren", "fuhr", ["fuhr", "fuhrst", "fuhr", "fuhren", "fuhrt", "fuhren"]],
    ["finden", "fand", ["fand", "fandest", "fand", "fanden", "fandet", "fanden"]],
    ["lesen", "las", ["las", "lasest", "las", "lasen", "last", "lasen"]],
    ["essen", "aß", ["aß", "aßest", "aß", "aßen", "aßt", "aßen"]],
    ["sein", "war", ["war", "warst", "war", "waren", "wart", "waren"]],
    ["werden", "wurde", ["wurde", "wurdest", "wurde", "wurden", "wurdet", "wurden"]],
    ["wissen", "wusste", ["wusste", "wusstest", "wusste", "wussten", "wusstet", "wussten"]],
    ["machen", "machte", ["machte", "machtest", "machte", "machten", "machtet", "machten"]],
    ["backen", "buk/backte", ["buk", "bukst", "buk", "buken", "bukt", "buken"]],
  ];
  for (const [lemma, pr, expected] of cases) {
    assert.deepEqual(conjugateGermanLocally(lemma, { praeteritum: pr, partizip2: "x", hilfsverb: "haben" }, "preteritum", "strong"), expected, lemma);
  }
});

test("Perfekt picks the auxiliary, and keeps both when both are allowed", () => {
  assert.deepEqual(conjugateGermanLocally("gehen", { praeteritum: "ging", partizip2: "gegangen", hilfsverb: "sein" }, "perfekt", "strong"),
    ["bin gegangen", "bist gegangen", "ist gegangen", "sind gegangen", "seid gegangen", "sind gegangen"]);
  assert.equal(conjugateGermanLocally("singen", { praeteritum: "sang", partizip2: "hat gesungen", hilfsverb: "haben" }, "perfekt", "strong")?.[2], "hat gesungen");
  assert.equal(conjugateGermanLocally("schwimmen", { praeteritum: "schwamm", partizip2: "geschwommen", hilfsverb: "haben/sein" }, "perfekt", "strong")?.[0],
    "habe geschwommen / bin geschwommen");
  assert.equal(conjugateGermanLocally("x", { praeteritum: "y", partizip2: "z", hilfsverb: "" }, "perfekt", "strong"), null);
});

test("key persons ask only where the verb can differ", () => {
  assert.deepEqual(keyPersons("present", "strong", 0), [1, 2]);
  assert.deepEqual(keyPersons("present", "special", 0), [0, 1, 2, 3, 4, 5]);
  assert.equal(keyPersons("present", "weak", 7).length, 1);
  assert.deepEqual(keyPersons("preteritum", "strong", 3), [1, 3]);
  assert.equal(keyPersons("perfekt", "weak", 4).length, 1);
  assert.equal(keyPersons("future", "strong", 5).length, 1);
  assert.deepEqual(keyPersons("present", "impersonal", 9), [2]);
});

test("conjugation answers are strict about the umlaut but not about the keyboard", () => {
  assert.equal(checkConjugationAnswer("fahrst", "fährst").verdict, "wrong");
  assert.equal(checkConjugationAnswer("faehrst", "fährst").verdict, "correct");
  assert.equal(checkConjugationAnswer("fährst", "fährst").verdict, "correct");
  assert.equal(checkConjugationAnswer("heisst", "heißt").verdict, "correct");
  assert.equal(checkConjugationAnswer("dauert", "dauert").verdict, "correct");
  assert.equal(checkConjugationAnswer("fährt", "fahrt").verdict, "wrong");
});

test("a conjugation ending is not forgiven as a typo; a Partizip slip still is", () => {
  assert.equal(checkConjugationAnswer("besucht", "besuchst").verdict, "wrong");
  assert.equal(checkConjugationAnswer("Besuchst", "besuchst").verdict, "correct");
  assert.equal(checkConjugationAnswer("geschwomen", "geschwommen", "umlaut").verdict, "almost");
  assert.equal(checkConjugationAnswer("gefaren", "gefahren", "exact").verdict, "wrong");
  assert.equal(checkAgainstAlternatives("bin geschwommen", "habe geschwommen / bin geschwommen", "exact").verdict, "correct");
  const miss = checkAgainstAlternatives("hab geschwommen", "habe geschwommen / bin geschwommen", "exact");
  assert.equal(miss.verdict, "wrong");
  assert.equal(miss.matched, "habe geschwommen");
});

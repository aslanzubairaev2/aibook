import assert from "node:assert/strict";
import test from "node:test";
import { allFieldsPass, isFullyMatched, matchFastFields, stripPronouns, tokenize } from "./fastMatch.ts";

test("tokenize lowercases and drops punctuation", () => {
  assert.deepEqual(tokenize("Ich gehe, du gehst."), ["ich", "gehe", "du", "gehst"]);
});

test("stripPronouns drops filler pronouns but keeps real words", () => {
  assert.deepEqual(stripPronouns(["ich", "habe", "du", "hast", "wir", "haben"]), ["habe", "hast", "haben"]);
  // "sie" is always filler here — the fields never expect it as an answer.
  assert.deepEqual(stripPronouns(["sie", "haben"]), ["haben"]);
});

test("matchFastFields consumes each field's own word count in order", () => {
  const fields = [
    { key: "praeteritum", label: "Präteritum", expected: "ging" },
    { key: "partizip2", label: "Partizip II", expected: "gegangen" },
  ];
  const results = matchFastFields(tokenize("ging gegangen"), fields);
  assert.ok(isFullyMatched(results));
  assert.equal(results[0].verdict, "correct");
  assert.equal(results[1].verdict, "correct");
});

test("a multi-word field (auxiliary + participle) consumes both its words", () => {
  const fields = [{ key: "perfekt-0", label: "ich", expected: "habe gegangen" }];
  const results = matchFastFields(tokenize("habe gegangen"), fields);
  assert.ok(isFullyMatched(results));
  assert.equal(results[0]!.verdict, "correct");
});

test("fields whose words have not arrived yet stay null instead of failing early", () => {
  const fields = [
    { key: "a", label: "a", expected: "ging" },
    { key: "b", label: "b", expected: "gegangen" },
  ];
  const results = matchFastFields(tokenize("ging"), fields);
  assert.equal(results[0]!.verdict, "correct");
  assert.equal(results[1], null);
  assert.equal(isFullyMatched(results), false);
});

test("pronouns spoken alongside the conjugation are filtered before matching", () => {
  const fields = [
    { key: "ich", label: "ich", expected: "habe" },
    { key: "du", label: "du", expected: "hast" },
    { key: "er/sie/es", label: "er/sie/es", expected: "hat" },
    { key: "wir", label: "wir", expected: "haben" },
    { key: "ihr", label: "ihr", expected: "habt" },
    { key: "sie/Sie", label: "sie/Sie", expected: "haben" },
  ];
  const withPronouns = tokenize("ich habe du hast er hat wir haben ihr habt sie haben");
  const results = matchFastFields(stripPronouns(withPronouns), fields);
  assert.ok(isFullyMatched(results));
  assert.ok(results.every((r) => r!.verdict === "correct"));

  const bare = tokenize("habe hast hat haben habt haben");
  const bareResults = matchFastFields(stripPronouns(bare), fields);
  assert.ok(isFullyMatched(bareResults));
  assert.ok(bareResults.every((r) => r!.verdict === "correct"));
});

test("allFieldsPass fails the step on one wrong field but tolerates an almost", () => {
  assert.equal(allFieldsPass([
    { key: "a", label: "a", expected: "ging", given: "ging", verdict: "correct" },
    { key: "b", label: "b", expected: "gegangen", given: "gegangn", verdict: "almost" },
  ]), true);
  assert.equal(allFieldsPass([
    { key: "a", label: "a", expected: "ging", given: "sang", verdict: "wrong" },
  ]), false);
});

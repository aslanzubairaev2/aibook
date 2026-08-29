import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  bareNoun,
  genderRuleExplanation,
  genderRuleHint,
  GENDER_RULES,
  isNounEntry,
  nounArticle,
  nounGender,
  suffixRuleFor,
} from "./nounForms.ts";

test("a stored article stands in for a missing gender column", () => {
  // A photographed page routinely gives «die Lösung» and no gender field; the
  // article it did give is already the answer.
  assert.equal(nounGender({ gender: "", article: "die" }), "f");
  assert.equal(nounGender({ gender: "", article: "der" }), "m");
  assert.equal(nounGender({ gender: "", article: "", headword: "das Fenster" }), "n");
  assert.equal(nounGender({ gender: "", article: "", headword: "Fenster" }), null);
});

test("the article is derived from the gender when only the gender was saved", () => {
  assert.equal(nounArticle({ gender: "n", article: "" }), "das");
  assert.equal(nounArticle({ gender: "pl", article: "" }), "die");
  assert.equal(nounArticle({ gender: "", article: "" }), "");
});

test("the Singular column shows the noun without its article", () => {
  assert.equal(bareNoun({ headword: "die Lösung" }), "Lösung");
  assert.equal(bareNoun({ headword: "die Lösung", lemma: "Lösung" }), "Lösung");
  assert.equal(bareNoun({ headword: "Haus" }), "Haus");
});

test("the longer ending wins over the shorter one it contains", () => {
  // «Dokument» ends in both -ent (masculine, people) and -ment (neuter,
  // loanwords). Reading it as -ent would teach the wrong article.
  assert.equal(suffixRuleFor("Dokument")?.id, "ment");
  assert.equal(suffixRuleFor("Student")?.id, "ent");
  assert.equal(suffixRuleFor("Rentner")?.id, "ner");
  assert.equal(suffixRuleFor("Lehrer")?.id, "er");
});

test("the Ge- prefix beats the weak -e ending", () => {
  // «Gebäude» is neuter because of Ge-, not feminine because of -e; without
  // the priority the 90%-reliable -e rule would win on length alone.
  assert.equal(suffixRuleFor("Gebäude")?.id, "ge");
  assert.equal(suffixRuleFor("Gespräch")?.id, "ge");
  // …but a strong ending still beats the prefix.
  assert.equal(suffixRuleFor("Gebrauchsanweisung")?.id, "ung");
});

test("a word no longer than its own ending is not that kind of word", () => {
  assert.equal(suffixRuleFor("or"), null);
  assert.equal(suffixRuleFor("e"), null);
  assert.equal(suffixRuleFor(""), null);
});

test("the hint before the answer never contains the article itself", () => {
  // The whole point of the pre-answer nudge is that it points at the rule
  // without answering the question. A hint that prints "die" is the answer.
  for (const rule of GENDER_RULES) {
    const words = rule.nudge.toLowerCase().split(/[^a-zа-яё-]+/);
    for (const article of ["der", "die", "das"]) {
      assert.ok(
        !words.includes(article),
        `подсказка для ${rule.label} выдаёт ответ словом «${article}»: ${rule.nudge}`,
      );
    }
  }
});

test("the explanation after the answer does name the article", () => {
  const explanation = genderRuleExplanation("Lösung", "f");
  assert.ok(explanation?.includes("die"), explanation ?? "нет разбора");
});

test("a word that breaks its own rule is explained as the exception it is", () => {
  // «das Messer» ends in -er, whose rule says masculine. Explaining it with
  // that rule would teach exactly the wrong thing about this very word.
  const explanation = genderRuleExplanation("Messer", "n");
  assert.ok(explanation?.startsWith("«Messer» — исключение"), explanation ?? "нет разбора");

  const regular = genderRuleExplanation("Lehrer", "m");
  assert.ok(!regular?.includes("исключение"), regular ?? "нет разбора");
});

test("a word whose ending says nothing gets no rule at all", () => {
  assert.equal(genderRuleHint("Buch"), null);
  assert.equal(genderRuleExplanation("Buch", "n"), null);
});

test("every rule's article agrees with the gender it teaches", () => {
  const expected: Record<string, string> = { m: "der", f: "die", n: "das", pl: "die" };
  for (const rule of GENDER_RULES) {
    assert.ok(
      rule.explanation.includes(expected[rule.gender]),
      `разбор для ${rule.label} не называет артикль ${expected[rule.gender]}`,
    );
  }
});

test("a row with no part_of_speech but a filled gender/article is still a noun", () => {
  // The exact shape a broken photo import left in the real database: gender
  // and article filled in by the model, part_of_speech left blank.
  assert.equal(isNounEntry({ part_of_speech: "", gender: "f", article: "die" }), true);
  assert.equal(isNounEntry({ part_of_speech: "", gender: "", article: "der" }), true);
  assert.equal(isNounEntry({ part_of_speech: "", gender: "", article: "", headword: "das Fenster" }), true);
});

test("an explicit non-noun part of speech is never overridden by the fallback", () => {
  // A verb entry with no gender/article of its own must not be reclassified
  // just because its part_of_speech happens to be missing metadata a noun
  // would have — the check on the stored value always wins first.
  assert.equal(isNounEntry({ part_of_speech: "глагол", gender: "", article: "" }), false);
});

test("a row with nothing at all — no part_of_speech, no gender, no article — is not a noun", () => {
  assert.equal(isNounEntry({ part_of_speech: "", gender: "", article: "", headword: "schnell" }), false);
});

test("the stored part_of_speech is trusted first, whatever its case", () => {
  assert.equal(isNounEntry({ part_of_speech: "Существительное", gender: "" }), true);
});

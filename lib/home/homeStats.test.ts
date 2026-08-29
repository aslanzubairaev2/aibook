import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNounStats, computeVerbStats, mergeDictionaries } from "./homeStats.ts";
import type { DictionaryEntry } from "../db/dictionaryStore.ts";

function entry(over: Partial<DictionaryEntry> & { id: string }): DictionaryEntry {
  return {
    batch_id: null,
    headword: "",
    lemma: "",
    language: "de",
    translation: "",
    part_of_speech: "",
    gender: "",
    article: "",
    plural: "",
    forms: {},
    cefr: "",
    ...over,
  } as DictionaryEntry;
}

test("глаголы: считаются только неправильные без сохранённых форм", () => {
  const stats = computeVerbStats([
    entry({ id: "1", lemma: "gehen", part_of_speech: "глагол" }),
    entry({ id: "2", lemma: "machen", part_of_speech: "глагол" }),
    entry({ id: "3", lemma: "trinken", part_of_speech: "глагол", forms: { praeteritum: "trank", partizip2: "getrunken" } }),
    entry({ id: "4", lemma: "Haus", part_of_speech: "существительное" }),
  ]);

  assert.equal(stats.total, 3, "существительное не должно попасть в глаголы");
  assert.equal(stats.irregular, 2, "gehen и trinken неправильные, machen — нет");
  assert.equal(stats.missingForms, 1, "формы не заполнены только у gehen");
});

test("существительные: артикль засчитывается и когда род выводится из записи", () => {
  const stats = computeNounStats([
    entry({ id: "1", headword: "Ball", part_of_speech: "существительное", gender: "m" }),
    entry({ id: "2", headword: "Lösung", part_of_speech: "существительное", article: "die" }),
    entry({ id: "3", headword: "das Haus", part_of_speech: "существительное" }),
    entry({ id: "4", headword: "Sache", part_of_speech: "существительное" }),
    entry({ id: "5", lemma: "gehen", part_of_speech: "глагол" }),
  ]);

  assert.equal(stats.total, 4);
  assert.equal(stats.withArticle, 3, "род берётся из gender, из article и из приклеенного артикля");
  assert.equal(stats.withoutArticle, 1);
  assert.deepEqual(stats.byGender, { m: 1, f: 1, n: 1, pl: 0 });
});

test("«самый слабый род» не показывается, пока сравнивать нечего", () => {
  const few = computeNounStats([
    entry({ id: "1", headword: "Ball", part_of_speech: "существительное", gender: "m" }),
    entry({ id: "2", headword: "Haus", part_of_speech: "существительное", gender: "n" }),
  ]);
  assert.equal(few.weakestGender, null, "на двух словах это шум, а не наблюдение");

  const many = computeNounStats([
    ...Array.from({ length: 8 }, (_, i) => entry({ id: `m${i}`, headword: `M${i}`, part_of_speech: "существительное", gender: "m" })),
    ...Array.from({ length: 5 }, (_, i) => entry({ id: `f${i}`, headword: `F${i}`, part_of_speech: "существительное", gender: "f" })),
    ...Array.from({ length: 2 }, (_, i) => entry({ id: `n${i}`, headword: `N${i}`, part_of_speech: "существительное", gender: "n" })),
  ]);
  assert.equal(many.weakestGender, "n");
});

test("словари глаголов и существительных объединяются без дубликатов", () => {
  const shared = entry({ id: "same", lemma: "gehen" });
  const merged = mergeDictionaries([shared, entry({ id: "a" })], [shared, entry({ id: "b" })]);
  assert.equal(merged.length, 3);
});

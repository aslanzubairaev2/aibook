import assert from "node:assert/strict";
import { test } from "node:test";
import { computeHomeStats, computeNounStats, computeVerbStats, mergeDictionaries } from "./homeStats.ts";
import type { DictionaryEntry } from "../db/dictionaryStore.ts";
import type { Flashcard } from "../types.ts";

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

function card(over: Partial<Flashcard> & { id: string }): Flashcard {
  return {
    type: "word", source: "тест", addedAt: "2026-01-01T00:00:00.000Z",
    front: "Wort", back: "слово",
    status: "review", repetitions: 3, lapses: 0, intervalDays: 5, easeFactor: 2.5,
    dueAt: "2026-01-01T00:00:00.000Z", lastReviewedAt: "2025-12-27T00:00:00.000Z",
    ...over,
  } as Flashcard;
}

/**
 * Заголовок главной и кнопка под ним обязаны описывать одну и ту же работу.
 *
 * Ошибка, ради которой написан тест: слово выбиралось по одному направлению
 * («узнавание»), а число на кнопке считалось по всем трём. Получался экран, где
 * написано «на сегодня всё», а кнопка рядом предлагает повторить шестьдесят
 * карточек.
 */
test("слово дня и счётчик повторений не могут противоречить друг другу", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");
  const future = "2026-04-01T00:00:00.000Z";

  // Прямое направление пройдено далеко вперёд, обратное — нет.
  const cards = [card({ id: "c1", front: "nehmen", dueAt: future })];
  const variantProgress = {
    c1: { reverse: { status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: future, lastReviewedAt: null } },
  };

  const stats = computeHomeStats(cards, variantProgress as never, [], now);
  assert.equal(stats.words.due, 1, "обратное направление ещё не пройдено — карточка на сегодня");
  assert.ok(stats.nextUp, "раз есть что повторять, слово дня обязано найтись");
  assert.equal(stats.nextUp?.front, "nehmen");
});

test("когда повторять нечего — ни счётчика, ни слова дня", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");
  const future = "2026-04-01T00:00:00.000Z";
  const done = { status: "review", repetitions: 3, lapses: 0, intervalDays: 20, easeFactor: 2.5, dueAt: future, lastReviewedAt: "2026-03-01T00:00:00.000Z" };

  const cards = [card({ id: "c1", dueAt: future })];
  const stats = computeHomeStats(cards, { c1: { reverse: done, audio: done } } as never, [], now);

  assert.equal(stats.words.due, 0);
  assert.equal(stats.nextUp, null, "иначе экран предложил бы повторить то, что не назначено");
});

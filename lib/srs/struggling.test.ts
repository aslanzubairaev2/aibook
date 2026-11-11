import assert from "node:assert/strict";
import test from "node:test";

import { buildTrainQueue, countTrainCandidates } from "../cards.ts";
import type { Flashcard } from "../types.ts";
import { emptyModuleProgress, recordAnswer } from "./packProgress.ts";
import { recordDrillAnswer } from "./drillSchedule.ts";
import { cardsForWordKeys, strugglingWordKeys, wordKey } from "./struggling.ts";

const NOW = Date.parse("2026-08-29T10:00:00.000Z");
const TODAY_END = Date.parse("2026-08-29T23:59:59.999Z");

function card(id: string, front: string): Flashcard {
  return {
    id, type: "word", front, back: "x", source: "", addedAt: "2026-08-01T00:00:00.000Z",
    status: "review", repetitions: 5, lapses: 0, intervalDays: 30, easeFactor: 2.5,
    dueAt: "2026-09-20T00:00:00.000Z", lastReviewedAt: "2026-08-20T00:00:00.000Z", stability: 30, difficulty: 3,
  };
}

test("a word is the same word with or without its article, reflexive or plural", () => {
  assert.equal(wordKey("der Hund"), "hund");
  assert.equal(wordKey("Hund, -e"), "hund");
  assert.equal(wordKey("sich erinnern (an + Akk.)"), "erinnern");
  assert.equal(wordKey("  Die  Katze "), "katze");
});

test("a word missed twice in a grammar trainer is a hard card too", () => {
  let nouns = emptyModuleProgress();
  nouns = recordAnswer(nouns, "n1", false, true, NOW);
  nouns = recordAnswer(nouns, "n1", false, false, NOW + 1);
  nouns = recordAnswer(nouns, "n2", false, true, NOW);

  let verbs = emptyModuleProgress();
  verbs = recordDrillAnswer(verbs, "v1", "forms", false, true, NOW);
  verbs = recordDrillAnswer(verbs, "v1", "forms", false, false, NOW + 1);

  const keys = strugglingWordKeys([
    { entries: [{ id: "n1", lemma: "Hund" }, { id: "n2", lemma: "Katze" }], progress: nouns },
    { entries: [{ id: "v1", lemma: "sich erinnern" }], progress: verbs },
  ]);
  // One mistake is not «трудное» yet.
  assert.deepEqual([...keys].sort(), ["erinnern", "hund"]);

  const cards = [card("c1", "der Hund"), card("c2", "die Katze"), card("c3", "sich erinnern")];
  const extraHard = cardsForWordKeys(cards, keys);
  assert.deepEqual([...extraHard].sort(), ["c1", "c3"]);

  // None of these cards is hard by its own schedule, nor due.
  const selection = { status: "hard" as const, type: "all" as const, variants: ["forward" as const] };
  assert.equal(buildTrainQueue(cards, selection, {}, TODAY_END).length, 0);
  assert.deepEqual(buildTrainQueue(cards, { ...selection, extraHard }, {}, TODAY_END).map((i) => i.card.id).sort(), ["c1", "c3"]);
  assert.equal(countTrainCandidates(cards, { ...selection, extraHard }, {}, TODAY_END).byStatus.hard, 2);
  // The scheduled session is untouched by it.
  assert.equal(buildTrainQueue(cards, { ...selection, status: "all", extraHard }, {}, TODAY_END).length, 0);
});

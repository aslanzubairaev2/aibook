import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TRAIN_VARIANTS, filterCardsByTrainingSource, getCardsVariantProgress } from "./cards.ts";
import type { CardVariantState, Flashcard } from "./types.ts";

function card(id: string, sourceBookId: string, repetitions = 0): Flashcard {
  return {
    id,
    type: "word",
    front: `front-${id}`,
    back: `back-${id}`,
    source: "Одинаковый заголовок",
    addedAt: "2026-08-13T00:00:00.000Z",
    status: repetitions > 0 ? "review" : "new",
    repetitions,
    lapses: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: "2026-08-13T23:59:59.999Z",
    sourceBookId,
    sourceBookTitle: "Одинаковый заголовок",
  };
}

test("dictionary batch training includes all three independent variants", () => {
  assert.deepEqual(ALL_TRAIN_VARIANTS, ["forward", "reverse", "audio"]);

  const cards = [card("one", "batch-a", 1), card("two", "batch-a")];
  const variants: Record<string, CardVariantState> = {
    one: { reverse: { status: "review", repetitions: 1, lapses: 0, intervalDays: 1, easeFactor: 2.5, dueAt: "2026-08-14T23:59:59.999Z", lastReviewedAt: null } },
  };

  assert.deepEqual(getCardsVariantProgress(cards, variants), { learned: 2, total: 6 });
});

test("dictionary batch filter uses its id when titles collide", () => {
  const cards = [card("one", "batch-a"), card("two", "batch-b")];
  assert.deepEqual(
    filterCardsByTrainingSource(cards, "Одинаковый заголовок", "batch-a").map((item) => item.id),
    ["one"],
  );
});

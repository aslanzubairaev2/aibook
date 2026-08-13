import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TRAIN_VARIANTS, createBatchTrainingFilters, filterCardsByTrainingSource, getCardsVariantProgress, getReviewHistoryPosition, mergeCardVariantProgress, splitCardBack } from "./cards.ts";
import type { CardVariantState, Flashcard, SkillProgress } from "./types.ts";

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

function progress(repetitions: number, lastReviewedAt: string): SkillProgress {
  return {
    status: "review",
    repetitions,
    lapses: 0,
    intervalDays: repetitions,
    easeFactor: 2.5,
    dueAt: "2026-08-14T23:59:59.999Z",
    lastReviewedAt,
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

test("opening a dictionary batch persists its exact id, not only its non-unique title", () => {
  const filters = createBatchTrainingFilters(
    { trainBook: "Старая пачка", trainSourceId: "old-id", trainStatus: "hard" },
    "new-id",
    "Одинаковый заголовок",
  );

  assert.equal(filters.trainBook, "Одинаковый заголовок");
  assert.equal(filters.trainSourceId, "new-id");
  assert.equal(filters.trainStatus, "all");
});

test("reverse prompts separate the native meaning from dictionary grammar", () => {
  assert.deepEqual(splitCardBack("имя\nмн. ч.: die Namen"), {
    meaning: "имя",
    details: "мн. ч.: die Namen",
  });
  assert.deepEqual(splitCardBack("приглашать"), { meaning: "приглашать", details: "" });
});

test("variant progress keeps whichever copy was reviewed most recently", () => {
  const older = progress(2, "2026-08-12T10:00:00.000Z");
  const newer = progress(3, "2026-08-13T10:00:00.000Z");
  const merged = mergeCardVariantProgress(
    { card1: { reverse: newer } },
    { card1: { reverse: older, audio: older } },
  );
  assert.equal(merged.card1.reverse, newer);
  assert.equal(merged.card1.audio, older);
});

test("review history stays within the completed cards and exposes safe navigation", () => {
  assert.equal(getReviewHistoryPosition(0, 0), null);
  assert.equal(getReviewHistoryPosition(3, null), null);
  assert.deepEqual(getReviewHistoryPosition(3, -5), {
    index: 0,
    canGoOlder: false,
    canGoNewer: true,
  });
  assert.deepEqual(getReviewHistoryPosition(3, 99), {
    index: 2,
    canGoOlder: true,
    canGoNewer: false,
  });
});

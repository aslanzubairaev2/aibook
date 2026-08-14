import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TRAIN_VARIANTS, buildTrainQueue, computeDeckStats, countTrainCandidates, deckInsight, resolveCardFilters, filterCardsByTrainingSource, getCardsVariantProgress, getReviewHistoryPosition, mergeCardVariantProgress, splitCardBack } from "./cards.ts";
import type { CardVariantState, Flashcard, SkillProgress, TrainVariant } from "./types.ts";

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

test("a dictionary batch narrows by its exact id, not only its non-unique title", () => {
  const saved = { trainBook: "Своя книга", trainSourceId: "book-id", trainStatus: "hard" as const, trainFilter: "word" as const, trainMode: "active" as const };
  const session = resolveCardFilters(saved, { id: "new-id", title: "Одинаковый заголовок" });

  assert.equal(session.trainSourceId, "new-id");
  assert.equal(session.trainBook, "Одинаковый заголовок");
  // Leftover narrowing would hide most of the batch, so the batch clears it.
  assert.equal(session.trainStatus, "all");
  assert.equal(session.trainFilter, "all");
  assert.equal(session.trainMode, "recognize");
  assert.deepEqual(session.trainVariants, ALL_TRAIN_VARIANTS);
});

test("a batch never overwrites the learner's own training setup", () => {
  const saved = {
    trainBook: "Своя книга",
    trainSourceId: "book-id",
    trainStatus: "hard" as const,
    trainFilter: "word" as const,
    trainMode: "active" as const,
    trainVariants: ["forward", "audio"] as TrainVariant[],
    filterLevel: "B1",
  };

  // Running a batch and then leaving it has to land back on the saved setup —
  // this is what "Начать тренировку" does after «тренировать пачку».
  resolveCardFilters(saved, { id: "batch-9", title: "Страница 12" });
  const restored = resolveCardFilters(saved, null);

  assert.equal(restored.trainSourceId, "book-id");
  assert.equal(restored.trainBook, "Своя книга");
  assert.equal(restored.trainStatus, "hard");
  assert.equal(restored.trainFilter, "word");
  assert.equal(restored.trainMode, "active");
  assert.deepEqual(restored.trainVariants, ["forward", "audio"]);
  assert.equal(restored.filterLevel, "B1");
});

test("an empty configuration falls back to a single forward direction", () => {
  const fresh = resolveCardFilters(undefined, null);

  assert.deepEqual(fresh.trainVariants, ["forward"]);
  assert.equal(fresh.trainBook, "all");
  assert.equal(fresh.trainSourceId, null);
  assert.equal(fresh.trainStatus, "all");
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

// --- Training queue and statistics -----------------------------------------

const NOW = new Date("2026-08-14T10:00:00.000Z");
const TODAY_END = new Date("2026-08-14T23:59:59.999Z").getTime();

function scheduled(overrides: Partial<Flashcard>): Flashcard {
  return { ...card("scheduled", "batch-a"), ...overrides };
}

function variant(dueAt: string, overrides: Partial<SkillProgress> = {}): SkillProgress {
  return {
    status: "review",
    repetitions: 1,
    lapses: 0,
    intervalDays: 1,
    easeFactor: 2.5,
    dueAt,
    lastReviewedAt: null,
    ...overrides,
  };
}

test("a card due in two directions produces one queue item per direction", () => {
  const cards = [scheduled({ id: "one", status: "review", repetitions: 1, dueAt: "2026-08-14T23:59:59.999Z" })];
  const progress: Record<string, CardVariantState> = {
    one: {
      reverse: variant("2026-08-14T23:59:59.999Z"),
      audio: variant("2026-09-01T23:59:59.999Z"),
    },
  };

  const queue = buildTrainQueue(
    cards,
    { status: "all", type: "all", variants: ALL_TRAIN_VARIANTS },
    progress,
    TODAY_END,
  );

  assert.deepEqual(queue.map((item) => item.variant).sort(), ["forward", "reverse"]);
});

test("a variant with no stored progress counts as new rather than being skipped", () => {
  const queue = buildTrainQueue(
    [scheduled({ id: "fresh" })],
    { status: "new", type: "all", variants: ALL_TRAIN_VARIANTS },
    {},
    TODAY_END,
  );

  assert.equal(queue.length, 3);
});

test("chip counts match the queue each chip would build", () => {
  const cards = [
    scheduled({ id: "word-due", type: "word", status: "review", repetitions: 1, dueAt: "2026-08-14T12:00:00.000Z" }),
    scheduled({ id: "phrase-new", type: "phrase" }),
    scheduled({ id: "word-hard", type: "word", status: "review", repetitions: 3, lapses: 4, dueAt: "2026-12-01T00:00:00.000Z" }),
  ];
  const selection = { status: "all" as const, type: "all" as const, variants: ["forward"] as TrainVariant[] };
  const counts = countTrainCandidates(cards, selection, {}, TODAY_END);

  assert.equal(counts.byStatus.all, buildTrainQueue(cards, selection, {}, TODAY_END).length);
  assert.equal(counts.byStatus.new, 1);
  assert.equal(counts.byStatus.review, 1);
  // Hard cards are drilled whatever their due date says.
  assert.equal(counts.byStatus.hard, 1);
  assert.equal(counts.byType.word, 1);
  assert.equal(counts.byType.phrase, 1);

  for (const status of ["new", "review", "relearning", "hard"] as const) {
    assert.equal(
      countTrainCandidates(cards, { ...selection, status }, {}, TODAY_END).byStatus[status],
      buildTrainQueue(cards, { ...selection, status }, {}, TODAY_END).length,
      `chip count disagrees with the queue for "${status}"`,
    );
  }
});

test("statistics count every direction, so the banner matches a full session", () => {
  const cards = [
    scheduled({ id: "one", status: "review", repetitions: 2, intervalDays: 30, dueAt: "2026-09-30T00:00:00.000Z", lastReviewedAt: "2026-08-14T09:00:00.000Z" }),
    scheduled({ id: "two" }),
  ];
  const progress: Record<string, CardVariantState> = {
    one: { reverse: variant("2026-08-14T23:59:59.999Z"), audio: variant("2026-08-16T23:59:59.999Z") },
  };

  const stats = computeDeckStats(cards, progress, NOW);

  // "two" is new in all three directions; "one" is settled forward but due in reverse.
  assert.equal(stats.dueReps, 4);
  assert.equal(stats.dueCards, 2);
  assert.deepEqual(stats.dueByVariant, { forward: 1, reverse: 2, audio: 1 });
  assert.equal(stats.totalVariants, 6);
  assert.equal(stats.learnedVariants, 3);
  assert.equal(stats.matureCards, 1);
  assert.equal(stats.byStatus.new, 1);
  assert.equal(stats.byStatus.review, 1);
  // The audio direction lands two days out.
  assert.equal(stats.forecast.find((day) => day.dayOffset === 2)?.count, 1);
  assert.equal(stats.streak, 1);
});

test("today's remaining work drops on every single grade, not once a card is finished", () => {
  // The banner reads dueReps, because dueCards only falls when all three of a
  // card's directions are done — a learner could grade fifteen prompts and
  // watch the old per-card number sit still.
  const cards = [scheduled({ id: "one" }), scheduled({ id: "two" })];

  const before = computeDeckStats(cards, {}, NOW);
  assert.equal(before.dueReps, 6);
  assert.equal(before.dueCards, 2);

  // One direction of one card graded away to tomorrow.
  const after = computeDeckStats(cards, {
    one: { reverse: variant("2026-08-20T23:59:59.999Z", { lastReviewedAt: NOW.toISOString() }) },
  }, NOW);

  assert.equal(after.dueReps, 5, "remaining repetitions must fall by one");
  assert.equal(after.dueCards, 2, "the card itself is still due in its other directions");
  assert.equal(after.reviewedToday, 1, "and today's done count must rise");
});

test("mastery is tracked per direction so the lagging one can be named", () => {
  // Twenty cards met in recognition, half of them in production, none by ear —
  // the shape of a real deck, where the gap is worth naming. A two-card deck
  // deliberately says nothing: a difference of one is not a finding.
  const cards = Array.from({ length: 20 }, (_, i) => scheduled({ id: `card-${i}`, repetitions: 3 }));
  const progress: Record<string, CardVariantState> = {};
  for (let i = 0; i < 10; i++) {
    progress[`card-${i}`] = { reverse: variant("2026-09-01T00:00:00.000Z", { repetitions: 2 }) };
  }

  const stats = computeDeckStats(cards, progress, NOW);

  assert.deepEqual(stats.startedByVariant, { forward: 20, reverse: 10, audio: 0 });
  assert.match(deckInsight(stats, NOW) ?? "", /Главный резерв — аудирование: начато 0 из 20/);

  const evenDeck = computeDeckStats([scheduled({ id: "one", repetitions: 3 })], {}, NOW);
  assert.doesNotMatch(deckInsight(evenDeck, NOW) ?? "", /Главный резерв/);
});

test("the takeaway stays quiet when there is nothing to say", () => {
  assert.equal(deckInsight(computeDeckStats([], {}, NOW), NOW), null);
});

test("statistics keep every source separate, dictionary batches included", () => {
  const cards = [
    scheduled({ id: "book", sourceBookId: "book-1", sourceBookTitle: "Роман", repetitions: 1, status: "review" }),
    scheduled({ id: "batch-one", sourceBookId: "batch-7", sourceBookTitle: "Страница 12" }),
    scheduled({ id: "batch-two", sourceBookId: "batch-7", sourceBookTitle: "Страница 12" }),
  ];

  const stats = computeDeckStats(cards, {}, NOW);
  const batch = stats.sources.find((source) => source.key === "batch-7");

  assert.equal(stats.sources.length, 2);
  assert.equal(batch?.title, "Страница 12");
  assert.equal(batch?.cards, 2);
  assert.equal(batch?.due, 2);
  assert.equal(batch?.learned, 0);
});

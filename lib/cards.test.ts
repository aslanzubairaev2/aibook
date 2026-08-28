import assert from "node:assert/strict";
import test from "node:test";
import { ALL_TRAIN_VARIANTS, buildTrainQueue, cardSourceKey, matchesSourceQuery, comparePacks, computeDeckStats, countTrainCandidates, deckInsight, describePackTraining, endOfTodayMs, getVariantProgress, isVariantDue, listCardSources, normalizePackTraining, resolveCardFilters, filterCardsByTrainingSource, getCardsVariantProgress, getReviewHistoryPosition, mergeCardVariantProgress, splitCardBack } from "./cards.ts";
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

// ─── The order of the packs ─────────────────────────────────────────────────

const PACKS = [
  { title: "Страница 56", createdAt: Date.parse("2026-08-13T10:00:00.000Z"), percent: 90 },
  { title: "Akkusativ · фразы", createdAt: Date.parse("2026-08-17T10:00:00.000Z"), percent: 0 },
  { title: "Аренда жилья", createdAt: Date.parse("2026-08-15T10:00:00.000Z"), percent: 40 },
];

const titlesSortedBy = (sort: Parameters<typeof comparePacks>[0]) =>
  [...PACKS].sort(comparePacks(sort)).map((p) => p.title);

test("by default the newest pack is the one at the top", () => {
  // The pack the learner just had built for them is what they opened the
  // screen for; it used to be appended under everything else.
  assert.deepEqual(titlesSortedBy("new"), ["Akkusativ · фразы", "Аренда жилья", "Страница 56"]);
});

test("the packs can be ordered by what is left to learn, and by what is nearly done", () => {
  assert.deepEqual(titlesSortedBy("unlearned"), ["Akkusativ · фразы", "Аренда жилья", "Страница 56"]);
  assert.deepEqual(titlesSortedBy("progress"), ["Страница 56", "Аренда жилья", "Akkusativ · фразы"]);
  // Russian collation, so Cyrillic titles come before Latin ones — which is
  // the alphabet this learner reads the list in.
  assert.deepEqual(titlesSortedBy("title"), ["Аренда жилья", "Страница 56", "Akkusativ · фразы"]);
});

test("packs at the same progress still read newest-first", () => {
  const untouched = [
    { title: "Старая", createdAt: Date.parse("2026-08-01T10:00:00.000Z"), percent: 0 },
    { title: "Новая", createdAt: Date.parse("2026-08-17T10:00:00.000Z"), percent: 0 },
  ];
  assert.deepEqual([...untouched].sort(comparePacks("unlearned")).map((p) => p.title), ["Новая", "Старая"]);
});

test("a pack with its own setup is trained the way the pack asks", () => {
  const saved = { trainStatus: "hard" as const, trainFilter: "word" as const, trainVariants: ["forward"] as TrainVariant[] };
  const session = resolveCardFilters(saved, {
    id: "pack-1",
    title: "Akkusativ · фразы",
    training: { variants: ["reverse", "audio"] as TrainVariant[], type: "sentence" as const, mode: "recognize" as const },
  });

  assert.deepEqual(session.trainVariants, ["reverse", "audio"]);
  assert.equal(session.trainFilter, "sentence");
  // Silent about status, so the batch default — everything in the pack — holds.
  assert.equal(session.trainStatus, "all");
});

test("a pack that says nothing still trains as the whole pack, in every direction", () => {
  const session = resolveCardFilters({ trainVariants: ["forward"] as TrainVariant[] }, {
    id: "pack-2",
    title: "Страница 56",
    training: null,
  });

  assert.deepEqual(session.trainVariants, ALL_TRAIN_VARIANTS);
  assert.equal(session.trainFilter, "all");
});

test("a pack that is only cards sharing a source is matched by title", () => {
  const session = resolveCardFilters(undefined, { id: "", title: "Урок 20 — Akkusativ" });

  assert.equal(session.trainSourceId, null);
  assert.equal(session.trainBook, "Урок 20 — Akkusativ");
});

test("preferences an outside agent invented are dropped, not obeyed", () => {
  const training = normalizePackTraining({
    variants: ["reverse", "sideways", 7],
    type: "haiku",
    status: "hard",
    mode: "telepathy",
    note: " по-русски с озвучкой ",
  });

  assert.deepEqual(training, { variants: ["reverse"], status: "hard", note: "по-русски с озвучкой" });
  // Nothing usable left means no preference at all, so the learner's own filters stay in charge.
  assert.equal(normalizePackTraining({ variants: [], type: "nonsense" }), null);
  assert.equal(normalizePackTraining("reverse"), null);
});

test("a pack's setup is described in the learner's own words", () => {
  assert.equal(
    describePackTraining({ variants: ["reverse", "audio"], type: "sentence" }),
    "Родной → Изучаемый · Аудио · только предложения",
  );
  assert.equal(describePackTraining(null), "");
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

test("excluding a source trains everything but it", () => {
  const cards = [
    card("one", "batch-a"),
    card("two", "batch-a"),
    card("three", "batch-b"),
  ];

  assert.deepEqual(
    filterCardsByTrainingSource(cards, "all", null, ["batch-a"]).map((c) => c.id),
    ["three"],
  );
  // Nothing excluded is the deck as it was.
  assert.equal(filterCardsByTrainingSource(cards, "all", null, []).length, 3);
  // Excluding every source is a choice the learner is allowed to make, and it
  // has to be visible as an empty queue rather than silently ignored.
  assert.equal(filterCardsByTrainingSource(cards, "all", null, ["batch-a", "batch-b"]).length, 0);
});

test("asking for one source outranks having excluded it", () => {
  // «Тренировать эту пачку» on a pack that is on the skip list must open that
  // pack, not argue with the learner about what they asked for a second ago.
  const cards = [card("one", "batch-a"), card("two", "batch-b")];

  assert.deepEqual(
    filterCardsByTrainingSource(cards, "all", "batch-a", ["batch-a"]).map((c) => c.id),
    ["one"],
  );
});

test("an excluded source is left out of the queue and out of the counts", () => {
  const cards = [
    scheduled({ id: "one", sourceBookId: "batch-a", type: "word" }),
    scheduled({ id: "two", sourceBookId: "batch-b", type: "word" }),
  ];
  const selection = {
    status: "all" as const,
    type: "all" as const,
    variants: ["forward"] as TrainVariant[],
    excluded: ["batch-a"],
  };

  assert.deepEqual(
    buildTrainQueue(cards, selection, {}, TODAY_END).map((item) => item.card.id),
    ["two"],
  );
  // The chip counts have to agree, or the panel promises cards the session
  // will not serve.
  assert.equal(countTrainCandidates(cards, selection, {}, TODAY_END).byType.all, 1);
});

test("a source is identified by its pack id, and by its title where there is none", () => {
  const fromPack = card("one", "batch-a");
  const older = { ...card("two", ""), sourceBookId: null, sourceBookTitle: "Старые слова" } as Flashcard;

  assert.equal(cardSourceKey(fromPack), "batch-a");
  assert.equal(cardSourceKey(older), "Старые слова");

  const sources = listCardSources([fromPack, older, card("three", "batch-a")]);
  assert.deepEqual(
    sources.map((s) => [s.key, s.cards, s.packId]),
    [["batch-a", 2, "batch-a"], ["Старые слова", 1, null]],
  );
});

test("the picker's search finds a source by its title", () => {
  // The list is what a deck of a thousand packs is chosen from, so the search
  // is the control that matters, not a convenience.
  const [pack] = listCardSources([card("one", "batch-a")]);
  const named = { ...pack, title: "Урок 20 — Akkusativ" };

  assert.equal(matchesSourceQuery(named, ""), true);
  assert.equal(matchesSourceQuery(named, "  "), true);
  assert.equal(matchesSourceQuery(named, "akkusativ"), true, "case is not part of the question");
  assert.equal(matchesSourceQuery(named, "Урок 20"), true);
  assert.equal(matchesSourceQuery(named, "dativ"), false);
});

test("the excluded sources survive a reload, and a pack being trained ignores them", () => {
  const saved = { trainExcluded: ["batch-a"] };
  assert.deepEqual(resolveCardFilters(saved).trainExcluded, ["batch-a"]);
  // Opening a pack deliberately is not the moment to apply the skip list.
  assert.deepEqual(resolveCardFilters(saved, { id: "batch-a", title: "Пачка" }).trainExcluded, []);
});

test("a drill takes the whole pack again, schedule or no schedule", () => {
  // «Пройти пачку заново» straight after finishing it: every card was graded a
  // moment ago, so nothing is due, and the ordinary queue is empty.
  const cards = [
    scheduled({ id: "one", status: "review", repetitions: 1, dueAt: "2026-09-01T00:00:00.000Z" }),
    scheduled({ id: "two", status: "review", repetitions: 2, dueAt: "2026-09-05T00:00:00.000Z" }),
  ];
  const selection = { status: "all" as const, type: "all" as const, variants: ["forward"] as TrainVariant[] };

  assert.equal(buildTrainQueue(cards, selection, {}, TODAY_END).length, 0);
  assert.equal(buildTrainQueue(cards, { ...selection, ignoreSchedule: true }, {}, TODAY_END).length, 2);
  // The counts the chips show follow the same rule, or the panel would promise
  // a session the queue cannot deliver.
  assert.equal(
    countTrainCandidates(cards, { ...selection, ignoreSchedule: true }, {}, TODAY_END).byType.all,
    2,
  );
});

test("a drill still respects the narrowing it was given", () => {
  const cards = [
    scheduled({ id: "word", type: "word", status: "review", repetitions: 1, dueAt: "2026-09-01T00:00:00.000Z" }),
    scheduled({ id: "phrase", type: "phrase", status: "review", repetitions: 1, dueAt: "2026-09-01T00:00:00.000Z" }),
    scheduled({ id: "elsewhere", sourceBookId: "batch-b", status: "review", repetitions: 1, dueAt: "2026-09-01T00:00:00.000Z" }),
  ];
  const drill = {
    status: "all" as const,
    type: "word" as const,
    variants: ["forward"] as TrainVariant[],
    sourceId: "batch-a",
    ignoreSchedule: true,
  };

  assert.deepEqual(
    buildTrainQueue(cards, drill, {}, TODAY_END).map((item) => item.card.id),
    ["word"],
  );
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
  assert.match(deckInsight(stats) ?? "", /главный резерв — аудирование: начато 0 из 20/);

  const evenDeck = computeDeckStats([scheduled({ id: "one", repetitions: 3 })], {}, NOW);
  assert.doesNotMatch(deckInsight(evenDeck) ?? "", /главный резерв/i);
});

test("the forecast opens on today, and today counts what was done as well as what is left", () => {
  const cards = [
    // Cleared this morning: the whole point is that it still shows up.
    scheduled({ id: "done", status: "review", repetitions: 3, intervalDays: 10, dueAt: "2026-08-24T09:00:00.000Z", lastReviewedAt: NOW.toISOString() }),
    scheduled({ id: "waiting" }),
  ];

  const stats = computeDeckStats(cards, {}, NOW);
  const today = stats.forecast[0];

  assert.equal(today.dayOffset, 0);
  assert.equal(today.date.getDate(), 14, "the column knows its own date");
  assert.equal(today.done, 1, "a prompt reviewed today is on today's column");
  assert.equal(today.count, stats.dueReps, "and so is everything still waiting");
  assert.equal(stats.forecast.length, 7);
  assert.equal(stats.forecast.at(-1)?.dayOffset, 6);
});

test("yesterday's unfinished session is named as carried over, not folded in silently", () => {
  const cards = [
    scheduled({ id: "late", status: "review", repetitions: 2, dueAt: "2026-08-12T09:00:00.000Z", lastReviewedAt: "2026-08-12T09:00:00.000Z" }),
    scheduled({ id: "today", status: "review", repetitions: 2, dueAt: "2026-08-14T20:00:00.000Z", lastReviewedAt: "2026-08-13T20:00:00.000Z" }),
  ];

  const stats = computeDeckStats(cards, {}, NOW);

  // Only the forward direction of "late" carries a date from an earlier day;
  // the untouched reverse and audio prompts are new, which is waiting, not late.
  assert.equal(stats.overdueReps, 1);
  assert.equal(stats.overdueCards, 1);
  assert.equal(stats.dueReps, 6);
  assert.match(deckInsight(stats) ?? "", /из них 1 с прошлых дней/);
});

test("a day in the forecast is named with its date, so it cannot be read as the one just gone", () => {
  // Saturday the 15th is tomorrow; on a Friday "в субботу" is unambiguous only
  // once the date is attached.
  const cards = Array.from({ length: 12 }, (_, i) =>
    scheduled({ id: `card-${i}`, status: "review", repetitions: 3, intervalDays: 6, dueAt: "2026-08-20T09:00:00.000Z", lastReviewedAt: NOW.toISOString() }),
  );
  const progress: Record<string, CardVariantState> = {};
  for (let i = 0; i < 12; i++) {
    progress[`card-${i}`] = {
      reverse: variant("2026-08-20T09:00:00.000Z", { repetitions: 2 }),
      audio: variant("2026-08-20T09:00:00.000Z", { repetitions: 2 }),
    };
  }

  const insight = deckInsight(computeDeckStats(cards, progress, NOW)) ?? "";
  assert.match(insight, /самый нагруженный день впереди — в четверг, 20 августа: 36 повторений/);
});

test("each direction counts its own review, so one graded prompt is one review", () => {
  // The trainer used to stamp the card's own lastReviewedAt when grading the
  // reverse prompt — "to keep the streak alive" — which made a single graded
  // prompt show up as two in «сделано сегодня».
  const cards = [scheduled({ id: "one", status: "review", repetitions: 2, dueAt: "2026-08-20T09:00:00.000Z", lastReviewedAt: "2026-08-12T09:00:00.000Z" })];
  const progress: Record<string, CardVariantState> = {
    one: { reverse: variant("2026-08-20T09:00:00.000Z", { repetitions: 1, lastReviewedAt: NOW.toISOString() }) },
  };

  const stats = computeDeckStats(cards, progress, NOW);
  assert.equal(stats.reviewedToday, 1);
  assert.equal(stats.forecast[0].done, 1);
  // …and the streak still sees today through that same timestamp.
  assert.equal(stats.streak, 1);
});

test("a cleared day says what was done rather than going quiet", () => {
  const cards = [
    scheduled({ id: "one", status: "review", repetitions: 3, intervalDays: 10, dueAt: "2026-08-24T09:00:00.000Z", lastReviewedAt: NOW.toISOString() }),
  ];
  const progress: Record<string, CardVariantState> = {
    one: {
      reverse: variant("2026-08-24T09:00:00.000Z", { repetitions: 2, lastReviewedAt: NOW.toISOString() }),
      audio: variant("2026-08-24T09:00:00.000Z", { repetitions: 2, lastReviewedAt: NOW.toISOString() }),
    },
  };

  const stats = computeDeckStats(cards, progress, NOW);
  assert.equal(stats.dueReps, 0);
  assert.match(deckInsight(stats) ?? "", /^Сегодня повторено 3 — на сегодня всё/);
});

test("the takeaway stays quiet when there is nothing to say", () => {
  assert.equal(deckInsight(computeDeckStats([], {}, NOW)), null);
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

// ─── "Cards due today" — the home screen badge must match the real list ────
//
// The home screen shows a single dueCardsCount number without building the
// actual queue the way CardsView does. These tests pin down that the two can
// never drift apart — same predicate, same today boundary, new and overdue
// cards both counted, zero handled cleanly.

test("computeDeckStats().dueCards always equals the count of cards a real due-list would show", () => {
  // Every direction is pinned explicitly (including a future reverse/audio
  // for the two "due" cards) so a card's due-ness here comes only from the
  // direction actually being asserted, not from an untouched direction
  // defaulting to "new" (and therefore always due) behind the scenes.
  const FUTURE = "2026-08-20T09:00:00.000Z";
  const cards = [
    scheduled({ id: "new-card" }), // never touched — new in every direction
    scheduled({ id: "due-today", status: "review", repetitions: 2, dueAt: "2026-08-14T20:00:00.000Z" }),
    scheduled({ id: "overdue", status: "review", repetitions: 2, dueAt: "2026-08-10T09:00:00.000Z" }),
    scheduled({ id: "not-due-at-all", status: "review", repetitions: 2, dueAt: FUTURE }),
  ];
  const progress: Record<string, CardVariantState> = {
    "due-today": { reverse: variant(FUTURE), audio: variant(FUTURE) },
    "overdue": { reverse: variant(FUTURE), audio: variant(FUTURE) },
    "not-due-at-all": { reverse: variant(FUTURE), audio: variant(FUTURE) },
  };
  const todayEndTime = endOfTodayMs(NOW);

  const stats = computeDeckStats(cards, progress, NOW);
  const actualDueList = cards.filter((card) =>
    ALL_TRAIN_VARIANTS.some((v) => isVariantDue(getVariantProgress(card, v, progress), todayEndTime)),
  );

  assert.equal(stats.dueCards, actualDueList.length);
  assert.equal(stats.dueCards, 3, "new, due-today and overdue count; the fully-future card does not");
  assert.deepEqual(
    new Set(actualDueList.map((c) => c.id)),
    new Set(["new-card", "due-today", "overdue"]),
  );
});

test("a card due at the very end of local today counts; one due a second into tomorrow does not", () => {
  // Boundary derived from endOfTodayMs itself (not a hardcoded ISO string),
  // so this holds regardless of the machine's local timezone.
  const todayEndTime = endOfTodayMs(NOW);
  const justInTime = scheduled({ id: "just-in-time", status: "review", repetitions: 1, dueAt: new Date(todayEndTime).toISOString() });
  const justAfter = scheduled({ id: "just-after", status: "review", repetitions: 1, dueAt: new Date(todayEndTime + 1000).toISOString() });
  // Reverse/audio pinned safely into next year so only the forward direction
  // above decides whether each card is due — an untouched direction defaults
  // to "new" (always due), which would otherwise mask the boundary check.
  const FAR_FUTURE = variant("2027-01-01T00:00:00.000Z");
  const progress: Record<string, CardVariantState> = {
    "just-in-time": { reverse: FAR_FUTURE, audio: FAR_FUTURE },
    "just-after": { reverse: FAR_FUTURE, audio: FAR_FUTURE },
  };

  const stats = computeDeckStats([justInTime, justAfter], progress, NOW);

  assert.equal(stats.dueCards, 1);
  assert.equal(stats.byStatus.review, 2, "both cards exist in the deck");
});

test("zero due cards is reported as zero, not a stale or negative count", () => {
  const FUTURE = variant("2026-09-01T00:00:00.000Z");
  const cards = [scheduled({ id: "future", status: "review", repetitions: 3, dueAt: "2026-09-01T00:00:00.000Z" })];
  // All three directions pinned into the future — a genuinely empty queue,
  // not one direction quietly defaulting to "new" (and so counting as due).
  const stats = computeDeckStats(cards, { future: { reverse: FUTURE, audio: FUTURE } }, NOW);
  assert.equal(stats.dueCards, 0);
  assert.equal(stats.dueReps, 0);
});

test("endOfTodayMs moves to the next boundary once the day turns over", () => {
  const day1 = endOfTodayMs(new Date("2026-08-14T10:00:00.000Z"));
  const day2 = endOfTodayMs(new Date("2026-08-15T00:30:00.000Z"));
  assert.ok(day2 > day1, "a later day's end-of-day boundary must be later");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainQueue, computeDeckStats, countIntroducedToday, countTrainCandidates, heldBackNewCards, normalizeNewPerDay } from "./cards.ts";
import type { Flashcard } from "./types.ts";

const NOW = new Date("2026-08-14T10:00:00.000Z");
const TODAY_END = new Date("2026-08-14T23:59:59.999Z").getTime();

function fresh(id: string, addedAt: string): Flashcard {
  return {
    id, type: "word", front: id, back: id, source: "", addedAt,
    status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: addedAt,
  };
}

function reviewed(id: string, lastReviewedAt: string, repetitions: number, lapses = 0, dueAt = "2026-08-14T08:00:00.000Z"): Flashcard {
  return { ...fresh(id, "2026-07-01T00:00:00.000Z"), status: "review", repetitions, lapses, intervalDays: 3, dueAt, lastReviewedAt };
}

const selection = { status: "all" as const, type: "all" as const, variants: ["forward" as const] };

test("a page of new words is spread over days, the newest first", () => {
  const cards = Array.from({ length: 30 }, (_, i) => fresh(`n${i}`, `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`));
  const held = heldBackNewCards(cards, 10, NOW);
  assert.equal(held.size, 20);
  // The ten most recently added are today's.
  assert.equal(held.has("n29"), false);
  assert.equal(held.has("n20"), false);
  assert.equal(held.has("n19"), true);

  const queue = buildTrainQueue(cards, { ...selection, heldNew: held }, {}, TODAY_END);
  assert.equal(queue.length, 10);
});

test("words already met today use up the day's allowance", () => {
  const cards = [
    reviewed("first-today", "2026-08-14T09:00:00.000Z", 1),
    reviewed("forgot-on-first-try", "2026-08-14T09:05:00.000Z", 0),
    // Old words reviewed today are not «new»: more successes, or a lapse, behind them.
    reviewed("old", "2026-08-14T09:10:00.000Z", 4),
    reviewed("old-lapsed", "2026-08-14T09:15:00.000Z", 0, 2),
    reviewed("yesterday", "2026-08-13T09:00:00.000Z", 1),
    ...Array.from({ length: 5 }, (_, i) => fresh(`n${i}`, `2026-08-1${i}T00:00:00.000Z`)),
  ];
  assert.equal(countIntroducedToday(cards, NOW), 2);
  assert.equal(heldBackNewCards(cards, 4, NOW).size, 3);
  assert.equal(heldBackNewCards(cards, 2, NOW).size, 5);
});

test("due reviews are never held back, and no limit means no holding", () => {
  const cards = [reviewed("due", "2026-08-10T09:00:00.000Z", 3), fresh("a", "2026-08-01T00:00:00.000Z"), fresh("b", "2026-08-02T00:00:00.000Z")];
  const held = heldBackNewCards(cards, 1, NOW);
  assert.deepEqual([...held], ["a"]);
  const queue = buildTrainQueue(cards, { ...selection, heldNew: held }, {}, TODAY_END);
  assert.deepEqual(queue.map((item) => item.card.id).sort(), ["b", "due"]);
  assert.equal(heldBackNewCards(cards, 0, NOW).size, 0);
});

test("a deliberate run ignores the limit; counts and statistics follow the queue", () => {
  const cards = [fresh("a", "2026-08-01T00:00:00.000Z"), fresh("b", "2026-08-02T00:00:00.000Z"), fresh("c", "2026-08-03T00:00:00.000Z")];
  const held = heldBackNewCards(cards, 1, NOW);

  // «Новые» chip and a drill serve everything.
  assert.equal(buildTrainQueue(cards, { ...selection, status: "new", heldNew: held }, {}, TODAY_END).length, 3);
  assert.equal(buildTrainQueue(cards, { ...selection, ignoreSchedule: true, heldNew: held }, {}, TODAY_END).length, 3);

  const counts = countTrainCandidates(cards, { ...selection, heldNew: held }, {}, TODAY_END);
  assert.equal(counts.byStatus.all, 1);
  assert.equal(counts.byStatus.new, 3);
  assert.equal(counts.byType.all, 1);

  const stats = computeDeckStats(cards, {}, NOW, held);
  assert.equal(stats.dueCards, 1);
  assert.equal(stats.dueReps, 1);
  assert.equal(stats.heldNewCards, 2);
});

test("an unknown stored limit falls back to the default", () => {
  assert.equal(normalizeNewPerDay(undefined), 20);
  assert.equal(normalizeNewPerDay(7), 20);
  assert.equal(normalizeNewPerDay(0), 0);
  assert.equal(normalizeNewPerDay(40), 40);
});

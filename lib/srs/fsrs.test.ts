import { test } from "node:test";
import assert from "node:assert/strict";
import { difficultyFromSm2, formatInterval, isStrugglingMemory, previewIntervals, recallChance, reviewMemory, type MemoryProgress } from "./fsrs.ts";

const NOW = new Date("2026-10-15T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const danke: MemoryProgress = {
  status: "review", repetitions: 5, lapses: 0, intervalDays: 30, easeFactor: 2.9,
  dueAt: NOW.toISOString(), lastReviewedAt: daysAgo(30),
};
const einsteigen: MemoryProgress = {
  status: "review", repetitions: 8, lapses: 1, intervalDays: 3, easeFactor: 2.6,
  dueAt: NOW.toISOString(), lastReviewedAt: daysAgo(3),
};
const fresh: MemoryProgress = {
  status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: NOW.toISOString(), lastReviewedAt: null,
};

test("an answer moves the word by how well it was remembered", () => {
  const p = previewIntervals(danke, NOW);
  assert.ok(p[1] <= 2, `«Забыл» brings it back within days, got ${p[1]}`);
  assert.ok(p[3] > 30, `«Помню» after a real month pushes it further, got ${p[3]}`);
  assert.ok(p[4] > p[3], "«Легко» goes further than «Помню»");
});

test("a word that slipped before grows more slowly than one that never did", () => {
  const shaky = reviewMemory(einsteigen, 3, NOW);
  const solid = reviewMemory({ ...einsteigen, lapses: 0, easeFactor: 2.5 }, 3, NOW);
  assert.ok(shaky.intervalDays <= solid.intervalDays);
  assert.ok(shaky.difficulty > solid.difficulty);
});

test("repeating a word the same day barely moves it — drilling cannot push it years ahead", () => {
  const sameDay = { ...danke, lastReviewedAt: NOW.toISOString(), dueAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString() };
  let p: MemoryProgress = sameDay;
  for (let i = 0; i < 10; i++) p = { ...p, ...reviewMemory(p, 4, NOW), easeFactor: p.easeFactor, lastReviewedAt: NOW.toISOString() };
  assert.ok(p.intervalDays < 365, `ten same-day «Легко» stay under a year, got ${p.intervalDays}`);
});

test("«Забыл» counts a lapse and marks the word as relearning", () => {
  const r = reviewMemory(danke, 1, NOW);
  assert.equal(r.lapses, 1);
  assert.equal(r.repetitions, 0);
  assert.equal(r.status, "relearning");
  assert.ok(Date.parse(r.dueAt) > NOW.getTime(), "never due «today» again from a whole-day scheduler");
});

test("a new word starts from FSRS's own first-answer values", () => {
  const p = previewIntervals(fresh, NOW);
  assert.ok(p[1] >= 1 && p[3] >= 1 && p[4] > p[3]);
  assert.equal(recallChance(fresh, NOW), 1);
});

test("difficulty from old data trusts lapses and low ease, not ease inflated by drilling", () => {
  assert.equal(difficultyFromSm2(3.5, 0), 5);
  assert.ok(difficultyFromSm2(2.5, 2) > difficultyFromSm2(2.5, 0));
  assert.ok(difficultyFromSm2(1.3, 0) > 9);
});

test("«Сложные» forgives an old lapse once the word has been answered well since", () => {
  const recovered: MemoryProgress = { ...danke, lapses: 2, difficulty: 5.2, stability: 40 };
  assert.equal(isStrugglingMemory(recovered), false);
  assert.equal(isStrugglingMemory({ ...recovered, difficulty: 8.1 }), true);
});

test("intervals read short on a button", () => {
  assert.equal(formatInterval(3), "3 дн.");
  assert.equal(formatInterval(60), "2 мес.");
  assert.equal(formatInterval(547), "1,5 г.");
});

test("an old interval is not trusted for a word that keeps slipping", () => {
  // einfach in «Говорю»: forgotten seven times, yet SM-2 gave it 27 days.
  const einfach: MemoryProgress = {
    status: "review", repetitions: 5, lapses: 7, intervalDays: 27, easeFactor: 1.9,
    dueAt: new Date(NOW.getTime() + 27 * 86_400_000).toISOString(), lastReviewedAt: NOW.toISOString(),
  };
  const p = previewIntervals(einfach, NOW);
  assert.ok(p[3] <= 4, `«Помню» brings it back within days, got ${p[3]}`);
  assert.equal(isStrugglingMemory(einfach), true);
});

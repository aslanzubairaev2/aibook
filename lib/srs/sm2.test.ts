import assert from "node:assert/strict";
import test from "node:test";
import { calculateSM2, clampDueAt, MAX_INTERVAL_DAYS } from "./sm2.ts";

test("repeated «Легко» never pushes a card past the interval ceiling", () => {
  let state = { repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5 };
  for (let i = 0; i < 40; i++) {
    const next = calculateSM2(4, state.repetitions, state.lapses, state.intervalDays, state.easeFactor);
    assert.ok(next.intervalDays <= MAX_INTERVAL_DAYS);
    assert.ok(Number.isFinite(Date.parse(next.dueAt)));
    state = next;
  }
  assert.equal(state.intervalDays, MAX_INTERVAL_DAYS);
});

test("an overgrown saved due date is pulled back, a normal one is kept", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");
  assert.equal(clampDueAt("2026-10-20T23:59:59.999Z", now), "2026-10-20T23:59:59.999Z");
  const clamped = clampDueAt("+197416-02-05T20:59:59.999Z", now);
  assert.ok(Date.parse(clamped) <= now.getTime() + (MAX_INTERVAL_DAYS + 1) * 86_400_000);
  assert.ok(Date.parse(clamped) > now.getTime());
});

test("a card drilled every day ahead of its due date does not run away", () => {
  // What actually happened: «Легко» on the same cards day after day in a pack
  // drill, each press multiplying the full scheduled interval.
  let state = { repetitions: 2, lapses: 0, intervalDays: 6, easeFactor: 2.5, dueAt: "", lastReviewedAt: "" };
  let day = new Date("2026-09-14T10:00:00.000Z");
  state.lastReviewedAt = day.toISOString();
  state.dueAt = new Date(day.getTime() + 6 * 86_400_000).toISOString();
  for (let i = 0; i < 10; i++) {
    day = new Date(day.getTime() + 86_400_000);
    const next = calculateSM2(4, state.repetitions, state.lapses, state.intervalDays, state.easeFactor, { ...state, now: day });
    state = { ...next, lastReviewedAt: day.toISOString() };
  }
  assert.ok(state.intervalDays < 60, `ten early reviews in ten days gave ${state.intervalDays} days`);
  assert.equal(state.easeFactor, 2.5, "early «Легко» does not inflate ease");
});

test("an on-time review still grows the interval normally", () => {
  const now = new Date("2026-10-10T10:00:00.000Z");
  const next = calculateSM2(3, 3, 0, 10, 2.5, { lastReviewedAt: "2026-09-30T10:00:00.000Z", dueAt: "2026-10-10T23:59:59.999Z", now });
  assert.equal(next.intervalDays, 25);
  const early = calculateSM2(3, 3, 0, 10, 2.5, { lastReviewedAt: "2026-10-09T10:00:00.000Z", dueAt: "2026-10-19T23:59:59.999Z", now });
  assert.equal(early.intervalDays, 10, "an early review keeps the interval rather than growing or shrinking it");
});

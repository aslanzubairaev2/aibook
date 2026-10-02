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

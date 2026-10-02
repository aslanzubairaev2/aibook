import assert from "node:assert/strict";
import test from "node:test";
import { restoreNounQuizSession } from "./nounQuizSession.ts";

const steps = (...keys: string[]) => keys.map((key) => ({ key }));
const ok = { ok: true };
const miss = { ok: false };

test("resumes on the first unanswered question in the saved order", () => {
  const restored = restoreNounQuizSession(steps("c", "a", "b", "d"), {
    stepKeys: ["a", "b", "c", "d"],
    answers: { a: ok, b: miss },
    retry: false,
  });
  assert.ok(restored);
  assert.deepEqual(restored.queue.map((s) => s.key), ["a", "b", "c", "d"]);
  assert.equal(restored.index, 2);
  assert.equal(restored.correctCount, 1);
  assert.deepEqual(restored.mistakes.map((s) => s.key), ["b"]);
});

test("drops removed steps and appends new ones after the saved order", () => {
  const restored = restoreNounQuizSession(steps("e", "a", "c"), {
    stepKeys: ["a", "b", "c"],
    answers: { a: ok, b: ok },
    retry: false,
  });
  assert.ok(restored);
  assert.deepEqual(restored.queue.map((s) => s.key), ["a", "c", "e"]);
  assert.equal(restored.index, 1);
  assert.deepEqual(Object.keys(restored.answers), ["a"]);
});

test("a retry round never grows past its mistakes", () => {
  const restored = restoreNounQuizSession(steps("a", "b", "c"), {
    stepKeys: ["b", "c"],
    answers: { b: ok },
    retry: true,
  });
  assert.ok(restored);
  assert.deepEqual(restored.queue.map((s) => s.key), ["b", "c"]);
  assert.equal(restored.index, 1);
});

test("an untouched retry round still resumes as the mistakes only", () => {
  const restored = restoreNounQuizSession(steps("a", "b", "c"), { stepKeys: ["c"], answers: {}, retry: true });
  assert.ok(restored);
  assert.deepEqual(restored.queue.map((s) => s.key), ["c"]);
  assert.equal(restored.index, 0);
});

test("nothing answered or everything answered starts fresh", () => {
  assert.equal(restoreNounQuizSession(steps("a"), null), null);
  assert.equal(restoreNounQuizSession(steps("a", "b"), { stepKeys: ["a", "b"], answers: {}, retry: false }), null);
  assert.equal(restoreNounQuizSession(steps("a", "b"), { stepKeys: ["a", "b"], answers: { a: ok, b: miss }, retry: false }), null);
});

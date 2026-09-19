import assert from "node:assert/strict";
import test from "node:test";
import { scheduleNounQuizSteps } from "./nounQuizQueue.ts";

function drills(id: string, count: number) {
  return Array.from({ length: count }, (_, order) => ({ entry: { id }, order }));
}

test("three article presentations for each noun are separated across the session", () => {
  const steps = Array.from({ length: 20 }, (_, i) => drills(`noun-${i}`, 3)).flat();
  const queue = scheduleNounQuizSteps(steps);
  assert.equal(queue.length, steps.length);
  for (let i = 0; i < queue.length; i++) {
    const nextSameNoun = queue.findIndex((step, next) => next > i && step.entry.id === queue[i].entry.id);
    if (nextSameNoun !== -1) assert.ok(nextSameNoun - i >= 20);
  }
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(queue.filter((step) => step.entry.id === `noun-${i}`).map((step) => step.order), [0, 1, 2]);
  }
});

test("missing presentations and a small retry deck do not reveal the same noun immediately", () => {
  for (const counts of [[3, 1, 1], [3, 2, 1], [2, 2]]) {
    const steps = counts.flatMap((count, i) => drills(`noun-${i}`, count));
    for (let attempt = 0; attempt < 20; attempt++) {
      const queue = scheduleNounQuizSteps(steps);
      for (let i = 1; i < queue.length; i++) {
        assert.notEqual(queue[i].entry.id, queue[i - 1].entry.id);
      }
    }
  }
});

test("every feasible small deck spaces repeated nouns", () => {
  for (let groups = 2; groups <= 5; groups++) {
    for (let encoded = 0; encoded < 6 ** groups; encoded++) {
      const counts = Array.from({ length: groups }, (_, i) => 1 + Math.floor(encoded / 6 ** i) % 6);
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (Math.max(...counts) > total - Math.max(...counts) + 1) continue;
      const steps = counts.flatMap((count, i) => drills(`noun-${i}`, count));
      for (let attempt = 0; attempt < 3; attempt++) {
        const queue = scheduleNounQuizSteps(steps);
        for (let i = 1; i < queue.length; i++) {
          assert.notEqual(queue[i].entry.id, queue[i - 1].entry.id, `counts=${counts.join(",")}`);
        }
      }
    }
  }
});

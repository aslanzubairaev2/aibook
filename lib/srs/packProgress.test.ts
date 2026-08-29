import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyModuleProgress,
  packCoverage,
  recordAnswer,
  recordSession,
  resetWords,
  type ModuleProgress,
} from "./packProgress.ts";

const NOW = Date.parse("2026-08-29T10:00:00.000Z");

/** Runs a whole session's answers through, the way a trainer does. */
function session(start: ModuleProgress, answers: [string, boolean][]): ModuleProgress {
  const seen = new Set<string>();
  let progress = start;
  for (const [id, correct] of answers) {
    progress = recordAnswer(progress, id, correct, !seen.has(id), NOW);
    seen.add(id);
  }
  return progress;
}

test("an untouched pack is at zero, not at NaN", () => {
  const coverage = packCoverage(emptyModuleProgress(), "pack", ["a", "b", "c"]);
  assert.equal(coverage.percent, 0);
  assert.equal(coverage.learned, 0);
  assert.equal(coverage.seen, 0);
  assert.equal(coverage.total, 3);
});

test("an empty pack does not divide by zero", () => {
  const coverage = packCoverage(emptyModuleProgress(), "pack", []);
  assert.equal(coverage.percent, 0);
  assert.equal(coverage.touchedPercent, 0);
});

test("a word answered right fills its slot; a missed one only dims it", () => {
  const progress = session(emptyModuleProgress(), [["a", true], ["b", false]]);
  const coverage = packCoverage(progress, "pack", ["a", "b", "c", "d"]);

  assert.equal(coverage.learned, 1);
  assert.equal(coverage.seen, 1);
  assert.equal(coverage.percent, 25);
  // Half the pack has been asked at all — the dim part of the bar.
  assert.equal(coverage.touchedPercent, 50);
});

test("every drill on a word must land for the word to count", () => {
  // Перевод right, артикль right, мн. ч. wrong — the word is not learned.
  const progress = session(emptyModuleProgress(), [["a", true], ["a", true], ["a", false]]);
  assert.equal(packCoverage(progress, "pack", ["a"]).percent, 0);
  assert.equal(progress.words.a.attempts, 3);
  assert.equal(progress.words.a.correct, 2);
});

test("a later session can rescue a word that was missed before", () => {
  // Missed on Monday, answered on Tuesday: the bar fills. Nothing about the
  // first session is held against it — this measures coverage, not history.
  const first = session(emptyModuleProgress(), [["a", false]]);
  const second = session(first, [["a", true]]);
  assert.equal(packCoverage(second, "pack", ["a"]).percent, 100);
});

test("a word answered right and then missed later drops back out", () => {
  const first = session(emptyModuleProgress(), [["a", true]]);
  const second = session(first, [["a", false]]);
  const coverage = packCoverage(second, "pack", ["a"]);
  assert.equal(coverage.learned, 0);
  assert.equal(coverage.seen, 1);
});

test("recordAnswer is pure, so React may call it twice with the same arguments", () => {
  const start = session(emptyModuleProgress(), [["a", false]]);
  const once = recordAnswer(start, "a", true, true, NOW);
  const twice = recordAnswer(start, "a", true, true, NOW);
  assert.deepEqual(once, twice);
  // …and the input was not mutated on the way through.
  assert.equal(start.words.a.ok, false);
});

test("growing a pack drops it back below 100%", () => {
  // Three words learned, then two new ones photographed into the same pack:
  // «прошёл ли я эту пачку» is honestly answered with "not any more".
  const progress = session(emptyModuleProgress(), [["a", true], ["b", true], ["c", true]]);
  assert.equal(packCoverage(progress, "pack", ["a", "b", "c"]).percent, 100);
  assert.equal(packCoverage(progress, "pack", ["a", "b", "c", "d", "e"]).percent, 60);
});

test("sessions are counted and dated per pack", () => {
  let progress = recordSession(emptyModuleProgress(), "pack", NOW);
  progress = recordSession(progress, "pack", NOW + 86_400_000);
  const coverage = packCoverage(progress, "pack", ["a"]);
  assert.equal(coverage.sessions, 2);
  assert.equal(coverage.lastTrainedAt, NOW + 86_400_000);
  // A different pack keeps its own count.
  assert.equal(packCoverage(progress, "other", ["a"]).sessions, 0);
});

test("resetting a pack forgets its words and its session count, and nothing else", () => {
  let progress = session(emptyModuleProgress(), [["a", true], ["b", true], ["z", true]]);
  progress = recordSession(progress, "pack", NOW);
  progress = recordSession(progress, "other", NOW);

  const after = resetWords(progress, ["a", "b"], "pack");
  assert.equal(packCoverage(after, "pack", ["a", "b"]).percent, 0);
  assert.equal(packCoverage(after, "pack", ["a", "b"]).sessions, 0);
  // The pack that was not reset is untouched.
  assert.equal(packCoverage(after, "other", ["z"]).percent, 100);
  assert.equal(packCoverage(after, "other", ["z"]).sessions, 1);
});

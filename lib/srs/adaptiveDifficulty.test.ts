import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveDifficultyScore, isDifficultWord, isUnfamiliarWord, matchesTrainingFilter } from "./adaptiveDifficulty";
import type { WordTrainingState } from "./packProgress";

const state = (attempts: number, correct: number, ok: boolean): WordTrainingState => ({
  attempts, correct, ok, at: 1,
});

test("unfamiliar means a word was attempted and the latest answer was wrong", () => {
  assert.equal(isUnfamiliarWord(undefined), false);
  assert.equal(isUnfamiliarWord(state(0, 0, false)), false);
  assert.equal(isUnfamiliarWord(state(1, 0, false)), true);
  assert.equal(isUnfamiliarWord(state(2, 1, true)), false);
});

test("difficult words require repeated mistakes and rank by history", () => {
  assert.equal(isDifficultWord(state(1, 0, false)), false);
  assert.equal(isDifficultWord(state(2, 0, false)), true);
  assert.ok(adaptiveDifficultyScore(state(4, 1, false)) > adaptiveDifficultyScore(state(10, 8, true)));
  assert.equal(matchesTrainingFilter(state(2, 0, false), "difficult"), true);
  assert.equal(matchesTrainingFilter(state(1, 0, false), "difficult"), false);
});

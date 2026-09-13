import type { WordTrainingState } from "./packProgress";

/**
 * A small, explainable local model for repeated mistakes.
 *
 * It intentionally uses only the learner's local answer history. Two or more
 * mistakes are required before a word is called difficult; the score then
 * combines repeat count and error rate, so a word missed 3/4 times ranks above
 * one missed 2/10 times. No answer data or API key leaves the device.
 */
export function trainingErrors(state: WordTrainingState | undefined): number {
  if (!state) return 0;
  return Math.max(0, state.attempts - state.correct);
}

export function adaptiveDifficultyScore(state: WordTrainingState | undefined): number {
  const errors = trainingErrors(state);
  if (!state || errors < 2 || state.attempts <= 0) return 0;
  const errorRate = errors / state.attempts;
  const recency = state.ok ? 0 : 1;
  return Number((errors * 2 + errorRate * 3 + recency).toFixed(3));
}

export function isDifficultWord(state: WordTrainingState | undefined): boolean {
  return adaptiveDifficultyScore(state) > 0;
}

export function isUnfamiliarWord(state: WordTrainingState | undefined): boolean {
  return Boolean(state && state.attempts > 0 && !state.ok);
}

export function matchesTrainingFilter(
  state: WordTrainingState | undefined,
  filter: "all" | "unfamiliar" | "difficult",
): boolean {
  if (filter === "unfamiliar") return isUnfamiliarWord(state);
  if (filter === "difficult") return isDifficultWord(state);
  return true;
}

export function countTrainingFilter(
  states: Record<string, WordTrainingState>,
  filter: "unfamiliar" | "difficult",
): number {
  return Object.values(states).filter((state) => matchesTrainingFilter(state, filter)).length;
}

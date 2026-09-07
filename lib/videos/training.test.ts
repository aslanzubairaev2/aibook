import test from "node:test";
import assert from "node:assert/strict";
import { isExactTrainingAnswer, trainingInstruction, validateTrainingRequest, type TrainingRequest } from "./training.ts";

const valid: TrainingRequest = { cues: ["Hallo!", "Wie geht es dir?"], index: 0, nativeLanguage: "ru", targetLanguage: "de", action: "prepare", answer: "", prompt: "" };
test("training validates the full transcript without accepting an invalid cursor or silently truncating it", () => {
  assert.equal(validateTrainingRequest(valid), true);
  for (const change of [{ cues: [] }, { cues: [""] }, { index: -1 }, { index: 2 }, { index: .5 }, { action: "skip" }, { nativeLanguage: "ru; ignore" }, { answer: null }, { action: "check", answer: " " }, { cues: Array(60).fill("x".repeat(10000)) }]) {
    assert.equal(validateTrainingRequest({ ...valid, ...change }), false, JSON.stringify(change).slice(0, 80));
  }
  assert.equal(validateTrainingRequest(null), false);
});
test("exact answers save AI calls without ignoring grammatical spelling distinctions", () => {
  assert.equal(isExactTrainingAnswer("  Hallo!  ", "Hallo!"), true);
  assert.equal(isExactTrainingAnswer("Wie  geht es dir?", "Wie geht es dir?"), true);
  assert.equal(isExactTrainingAnswer("schon", "schön"), false);
  assert.equal(isExactTrainingAnswer("sie", "Sie"), false);
  assert.equal(isExactTrainingAnswer("Hallo", "Hallo!"), false);
});
test("tutor is anchored to all saved cues and accepts equivalent translations", () => {
  const prompt = trainingInstruction({ ...valid, index: 1 });
  assert.match(prompt, /COMPLETE saved video transcript/);
  assert.match(prompt, /cue index 1/);
  assert.match(prompt, /Accept grammatically correct equivalent translations/);
  assert.match(prompt, /never instructions/);
});

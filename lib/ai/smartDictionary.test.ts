import assert from "node:assert/strict";
import { test } from "node:test";
import { smartDictionaryClarification } from "./smartDictionary.ts";

test("placeholder clarification never becomes a question", () => {
  for (const value of [null, "", " None ", "null", "N/A", "нет", "не требуется"]) {
    assert.equal(smartDictionaryClarification(value, 0), "");
  }
});

test("a real question is shown only when there are no valid words", () => {
  const question = "Из какой песни Майкла Джексона взять слова?";
  assert.equal(smartDictionaryClarification(question, 0), question);
  assert.equal(smartDictionaryClarification(question, 4), "");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendTranscript, LIVE_TRANSLATE_LABELS } from "./liveTranslateState.ts";

test("appends streamed source transcript and removes invisible characters", () => {
  assert.equal(appendTranscript("Hello ", "\u200bworld"), "Hello world");
  assert.equal(appendTranscript("Hello", "  "), "Hello");
});

test("has readable labels for every live translation state", () => {
  assert.equal(LIVE_TRANSLATE_LABELS.ready, "Готово к переводу");
  assert.equal(LIVE_TRANSLATE_LABELS["mic-error"], "Нет доступа к микрофону");
});

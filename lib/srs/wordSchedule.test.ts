import assert from "node:assert/strict";
import test from "node:test";

import { emptyModuleProgress, mergeModuleProgress, recordAnswer } from "./packProgress.ts";
import { countDueWords, isWordDue, planWordSession } from "./wordSchedule.ts";

const NOW = Date.parse("2026-08-29T10:00:00.000Z");
const DAY = 86_400_000;

test("a word answered right goes away for days; answered wrong it is back tomorrow", () => {
  let progress = recordAnswer(emptyModuleProgress(), "right", true, true, NOW, true);
  progress = recordAnswer(progress, "wrong", false, true, NOW, true);

  assert.equal(isWordDue(progress.words.right, NOW + DAY), false);
  assert.equal(isWordDue(progress.words.wrong, NOW + 2 * DAY), true);
  assert.ok(progress.words.right.mem!.intervalDays > progress.words.wrong.mem!.intervalDays);
  // Later the well-known word comes due again too.
  assert.equal(isWordDue(progress.words.right, NOW + 400 * DAY), true);
});

test("only the session's first answer is a review, but a later mistake still counts", () => {
  const first = recordAnswer(emptyModuleProgress(), "a", true, true, NOW, true);
  // Article right, then plural right: the second answer must not push further.
  const second = recordAnswer(first, "a", true, false, NOW + 1000, true);
  assert.deepEqual(second.words.a.mem, first.words.a.mem);

  // Article right, plural wrong: the word was not known after all.
  const slipped = recordAnswer(first, "a", false, false, NOW + 1000, true);
  assert.equal(slipped.words.a.ok, false);
  assert.ok(Date.parse(slipped.words.a.mem!.dueAt) < Date.parse(first.words.a.mem!.dueAt));
  // A second mistake in the same session is the same lapse, not another one.
  const again = recordAnswer(slipped, "a", false, false, NOW + 2000, true);
  assert.deepEqual(again.words.a.mem, slipped.words.a.mem);
});

test("verbs keep their word state free of a schedule — their drills carry it", () => {
  const progress = recordAnswer(emptyModuleProgress(), "v", true, true, NOW);
  assert.equal(progress.words.v.mem, undefined);
});

test("a session takes due words: met before first, longest waiting first, then new ones", () => {
  let progress = emptyModuleProgress();
  progress = recordAnswer(progress, "old", false, true, NOW - 10 * DAY, true);
  progress = recordAnswer(progress, "older", false, true, NOW - 20 * DAY, true);
  progress = recordAnswer(progress, "fresh-in-memory", true, true, NOW, true);
  // Answered before schedules existed: due, and ordered by when it was answered.
  progress = { ...progress, words: { ...progress.words, legacy: { ok: true, attempts: 1, correct: 1, at: NOW - 30 * DAY } } };

  const entries = ["never-1", "old", "fresh-in-memory", "legacy", "older", "never-2"].map((id) => ({ id }));
  assert.deepEqual(planWordSession(entries, progress.words, 0, NOW).map((e) => e.id), ["legacy", "older", "old", "never-1", "never-2"]);
  assert.deepEqual(planWordSession(entries, progress.words, 2, NOW).map((e) => e.id), ["legacy", "older"]);
  assert.equal(countDueWords(entries, progress.words, NOW), 5);
});

test("the schedule travels with the word when two devices are merged", () => {
  const phone = recordAnswer(emptyModuleProgress(), "a", true, true, NOW, true);
  const merged = mergeModuleProgress(emptyModuleProgress(), phone);
  assert.deepEqual(merged.words.a.mem, phone.words.a.mem);
});

// The numbers a teacher quotes back to the learner: first tries, hints,
// corrections, self-ratings kept apart, and «today» in the learner's zone.

import assert from "node:assert/strict";
import test from "node:test";
import { dayInZone, normalizeEvent, outcomeFromVerdict, type TrainingEvent } from "./events.ts";
import { summarizeTraining } from "./summary.ts";

let n = 0;
function ev(patch: Partial<TrainingEvent>): TrainingEvent {
  n++;
  return {
    client_event_id: `e${n}`, occurred_at: `2026-10-03T10:00:${String(n).padStart(2, "0")}.000Z`, local_date: "2026-10-03", time_zone: "Europe/Berlin",
    trainer: "nouns", mode: null, session_id: "s1", entry_id: null, card_id: null, word: "Haus", checks: "article",
    form: null, pronoun: null, tense: null, prompt: null, answer: "das", expected: "das", outcome: "correct",
    attempt_no: 1, hint_used: false, answer_shown: false, self_grade: null, meta: {}, ...patch,
  };
}

const PERIOD = { from: "2026-10-03", to: "2026-10-03", time_zone: "Europe/Berlin" };

test("first-try accuracy counts only clean first answers", () => {
  const s = summarizeTraining([
    ev({ word: "Haus" }),
    ev({ word: "Tisch", answer: "die", expected: "der", outcome: "incorrect" }),
    ev({ word: "Tisch", answer: "der", expected: "der", outcome: "correct", attempt_no: 2 }),
    ev({ word: "Lampe", answer: "die", expected: "die", hint_used: true }),
    ev({ word: "Uhr", checks: "plural", answer: "Uhrn", expected: "Uhren", outcome: "typo" }),
  ], PERIOD);
  assert.equal(s.totals.tasks, 5);
  assert.equal(s.totals.unique_words, 4);
  assert.equal(s.totals.first_try_checked, 4);
  assert.equal(s.totals.first_try_correct, 1, "a hinted answer is not a first-try success");
  assert.equal(s.totals.first_try_accuracy_percent, 25);
  assert.equal(s.totals.correct, 3);
  assert.equal(s.totals.typos, 1);
  assert.equal(s.totals.corrected_after_error, 1, "Tisch: wrong, then right on the retry");
  assert.equal(s.by_check.article.checked_answers, 4);
  assert.equal(s.difficult.articles.length, 1);
  assert.deepEqual([s.difficult.articles[0].word, s.difficult.articles[0].answer, s.difficult.articles[0].expected], ["Tisch", "die", "der"]);
  assert.equal(s.difficult.plurals[0].outcome, "typo");
});

test("conjugations and forms keep pronoun, tense and form; repeated errors are found", () => {
  const s = summarizeTraining([
    ev({ trainer: "verbs", word: "gehen", checks: "conjugation", pronoun: "du", tense: "perfekt", answer: "hast gegangen", expected: "bist gegangen", outcome: "incorrect" }),
    ev({ trainer: "verbs", word: "gehen", checks: "conjugation", pronoun: "du", tense: "perfekt", answer: "hast gegangen", expected: "bist gegangen", outcome: "incorrect", attempt_no: 2 }),
    ev({ trainer: "verbs", word: "gehen", checks: "form", form: "partizip2", answer: "gegangen", expected: "gegangen" }),
  ], PERIOD);
  assert.equal(s.difficult.conjugations.length, 2);
  assert.equal(s.difficult.conjugations[0].pronoun, "du");
  assert.equal(s.difficult.conjugations[0].tense, "perfekt");
  assert.equal(s.repeated_errors.length, 1);
  assert.equal(s.repeated_errors[0].wrong_times, 2);
  assert.equal(s.repeated_errors[0].fixed_later, false);
  const gehen = s.word_knowledge.find((w) => w.word === "gehen") as Record<string, unknown>;
  assert.deepEqual(gehen.conjugation, { right: 0, wrong: 2, typos: 0 });
  assert.deepEqual(gehen.verb_form, { right: 1, wrong: 0, typos: 0 }, "knowing the form and conjugating are separate");
});

test("flashcard self-ratings are their own count, never correct answers", () => {
  const s = summarizeTraining([
    ev({ trainer: "review", checks: "recognition", outcome: "self_rated", self_grade: 4 }),
    ev({ trainer: "review", checks: "recognition", outcome: "self_rated", self_grade: 1, word: "Tür" }),
  ], PERIOD);
  assert.equal(s.totals.tasks, 0);
  assert.equal(s.totals.correct, 0);
  assert.equal(s.flashcard_self_ratings.count, 2);
  assert.deepEqual(s.flashcard_self_ratings.grades, { forgot: 1, hard: 0, good: 0, easy: 1 });
});

test("«не знаю», skipped and technical are kept apart", () => {
  const s = summarizeTraining([
    ev({ outcome: "dont_know", answer: null }),
    ev({ outcome: "skipped", answer: "" }),
    ev({ outcome: "technical" }),
  ], PERIOD);
  assert.equal(s.totals.dont_know, 1);
  assert.equal(s.totals.skipped, 1);
  assert.equal(s.totals.technical_errors, 1);
  assert.equal(s.totals.checked_answers, 0);
  assert.equal(s.totals.accuracy_percent, null, "no checked answers is not 0 %");
});

test("events are validated; an empty typed answer is a skip, not a wrong answer", () => {
  assert.equal(normalizeEvent({ ...ev({}), trainer: "hacker" }), null);
  assert.equal(normalizeEvent({ ...ev({}), local_date: "yesterday" }), null);
  const self = normalizeEvent({ ...ev({ outcome: "correct" }), self_grade: 4 });
  assert.equal(self?.self_grade, null, "a self-grade only belongs to a self-rating");
  assert.equal(outcomeFromVerdict("wrong", "  "), "skipped");
  assert.equal(outcomeFromVerdict("almost", "Uhrn"), "typo");
});

test("«today» is the learner's day, not the server's", () => {
  const lateEvening = new Date("2026-10-03T22:30:00.000Z");
  assert.equal(dayInZone("Europe/Berlin", lateEvening), "2026-10-04", "00:30 in Berlin is already the next day");
  assert.equal(dayInZone("America/New_York", lateEvening), "2026-10-03");
  assert.equal(dayInZone("Not/AZone", lateEvening), "2026-10-03");
});

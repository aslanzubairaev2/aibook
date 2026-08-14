import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveQueue,
  checkTypedAnswer,
  exercisesPerCard,
  formatInterval,
  isSkillDue,
  previewIntervalDays,
  shouldSpeakOnReveal,
} from "./activeTraining.ts";
import type { Flashcard, ProductiveSkill, SkillProgress } from "../types.ts";

function card(id: string): Flashcard {
  return {
    id,
    type: "word",
    front: `front-${id}`,
    back: `back-${id}`,
    source: "Словарь",
    addedAt: "2026-08-13T00:00:00.000Z",
    status: "new",
    repetitions: 0,
    lapses: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: "2026-08-13T23:59:59.999Z",
  };
}

function progress(over: Partial<SkillProgress> = {}): SkillProgress {
  return {
    status: "review",
    repetitions: 2,
    lapses: 0,
    intervalDays: 4,
    easeFactor: 2.5,
    dueAt: "2026-08-14T23:59:59.999Z",
    lastReviewedAt: "2026-08-10T00:00:00.000Z",
    ...over,
  };
}

const noProgress = () => ({}) as Partial<Record<ProductiveSkill, SkillProgress>>;
// Keeps the internal shuffle a no-op so the assertions describe the ordering rule.
const stable = () => 0.9999999;

test("a session never asks about the same word twice in a row", () => {
  const cards = [card("a"), card("b"), card("c"), card("d")];
  const queue = buildActiveQueue(cards, noProgress, { random: stable });

  assert.ok(queue.length > cards.length, "several skills per word are scheduled");
  for (let i = 1; i < queue.length; i++) {
    assert.notEqual(queue[i].card.id, queue[i - 1].card.id, `positions ${i - 1}/${i} repeat the same card`);
  }
});

test("one word is not asked three ways in the same session once the deck is big enough", () => {
  const cards = Array.from({ length: 20 }, (_, i) => card(`c${i}`));
  const queue = buildActiveQueue(cards, noProgress, { random: stable });

  assert.equal(queue.length, 18);
  const perCard = new Map<string, number>();
  for (const item of queue) perCard.set(item.card.id, (perCard.get(item.card.id) ?? 0) + 1);
  assert.equal(Math.max(...perCard.values()), 1);
});

test("a small deck still spreads a word's skills across the whole session", () => {
  const queue = buildActiveQueue([card("a"), card("b")], noProgress, { random: stable });

  assert.equal(queue.length, 6);
  assert.deepEqual(queue.map((item) => item.card.id), ["a", "b", "a", "b", "a", "b"]);
  assert.equal(new Set(queue.filter((i) => i.card.id === "a").map((i) => i.skill)).size, 3);
});

test("the weakest skill of a word comes first", () => {
  const queue = buildActiveQueue([card("a")], (id) => (id === "a"
    ? { recall: progress({ repetitions: 5 }), listen: progress({ repetitions: 0, status: "relearning" }), produce: progress({ repetitions: 2 }) }
    : {}), { random: stable });

  assert.deepEqual(queue.map((item) => item.skill), ["listen", "produce", "recall"]);
});

test("skills scheduled for a later day stay out of today's session", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");
  const later = progress({ dueAt: "2026-08-20T23:59:59.999Z" });
  assert.equal(isSkillDue(later, now), false);
  assert.equal(isSkillDue(progress({ dueAt: "2026-08-14T23:59:59.999Z" }), now), true);
  assert.equal(isSkillDue(undefined, now), true);

  const queue = buildActiveQueue([card("a")], () => ({ recall: later, listen: later, produce: later }), { now, random: stable });
  assert.deepEqual(queue, []);
});

test("exercise budget shrinks as the deck grows", () => {
  assert.equal(exercisesPerCard(0), 0);
  assert.equal(exercisesPerCard(2), 3);
  assert.equal(exercisesPerCard(9), 2);
  assert.equal(exercisesPerCard(40), 1);
});

test("case, punctuation and spacing do not make an answer wrong", () => {
  assert.equal(checkTypedAnswer("  Der  Hof! ", "der Hof").verdict, "correct");
  assert.equal(checkTypedAnswer("die toilette", "die Toilette").verdict, "correct");
});

test("a missing umlaut counts as correct but says what to watch", () => {
  const check = checkTypedAnswer("die Hofe", "die Höfe");
  assert.equal(check.verdict, "correct");
  assert.match(check.hint ?? "", /Höfe/);
});

test("a dropped article is 'almost', and names the article", () => {
  const check = checkTypedAnswer("Hof", "der Hof");
  assert.equal(check.verdict, "almost");
  assert.match(check.hint ?? "", /der/);
});

test("a typo is 'almost' rather than a failure, but a different word is wrong", () => {
  assert.equal(checkTypedAnswer("Toilete", "die Toilette").verdict, "almost");
  assert.equal(checkTypedAnswer("half", "der Hof").verdict, "wrong");
  assert.equal(checkTypedAnswer("Haus", "Maus").verdict, "wrong");
  assert.equal(checkTypedAnswer("", "der Hof").verdict, "wrong");
});

test("grade buttons can say when the word comes back", () => {
  const fresh = progress({ repetitions: 0, intervalDays: 0, status: "new" });
  assert.equal(previewIntervalDays(1, fresh), 1);
  assert.equal(previewIntervalDays(3, fresh), 1);
  assert.equal(previewIntervalDays(4, fresh), 2);
  assert.ok(previewIntervalDays(4, progress()) > previewIntervalDays(3, progress()));

  assert.equal(formatInterval(0), "сегодня");
  assert.equal(formatInterval(1), "завтра");
  assert.equal(formatInterval(6), "через 6 дн.");
});

test("answering a listening prompt does not replay it back at the learner", () => {
  // The word was the question. Writing down what you just heard and being told
  // it again teaches nothing, so the replay is left to the button.
  assert.equal(shouldSpeakOnReveal("listen"), false);

  // The other two cue from written text, so the reveal is the first time the
  // word is heard — after writing it, that is the pronunciation; after saying
  // it aloud, it is what the learner checks their own attempt against.
  assert.equal(shouldSpeakOnReveal("recall"), true);
  assert.equal(shouldSpeakOnReveal("produce"), true);
});

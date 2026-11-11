import assert from "node:assert/strict";
import test from "node:test";

import { recordDrillAnswer } from "./srs/drillSchedule.ts";
import { emptyModuleProgress, recordAnswer } from "./srs/packProgress.ts";
import { buildTodayPlan } from "./today.ts";
import type { Flashcard } from "./types.ts";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const DAY = 86_400_000;

function card(id: string, over: Partial<Flashcard> = {}): Flashcard {
  return {
    id, type: "word", front: id, back: id, source: "", addedAt: "2026-08-01T00:00:00.000Z",
    status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

test("the day's plan separates reviews from new material in every trainer", () => {
  const cards = [
    card("due", { status: "review", repetitions: 3, intervalDays: 4, lastReviewedAt: "2026-08-20T00:00:00.000Z", dueAt: "2026-08-28T00:00:00.000Z" }),
    card("later", { status: "review", repetitions: 3, intervalDays: 30, lastReviewedAt: "2026-08-20T00:00:00.000Z", dueAt: "2026-09-20T00:00:00.000Z" }),
    card("new-1"), card("new-2"), card("new-3"),
  ];

  let verbs = emptyModuleProgress();
  verbs = recordDrillAnswer(verbs, "v-due", "translation", false, true, NOW.getTime() - 3 * DAY);
  verbs = recordDrillAnswer(verbs, "v-ok", "translation", true, true, NOW.getTime());

  let nouns = emptyModuleProgress();
  nouns = recordAnswer(nouns, "n-due", false, true, NOW.getTime() - 3 * DAY, true);
  nouns = recordAnswer(nouns, "n-ok", true, true, NOW.getTime(), true);

  const plan = buildTodayPlan({
    cards,
    variantProgress: {},
    newPerDay: 2,
    verbs: {
      entries: ["v-due", "v-ok", "v-new"].map((id) => ({ id, translation: "x" })),
      progress: verbs,
      modes: new Set(["translation"]),
      tenses: new Set(),
    },
    nouns: { entries: ["n-due", "n-ok", "n-new-1", "n-new-2"].map((id) => ({ id })), progress: nouns },
    otherPos: { entries: [], progress: emptyModuleProgress() },
    now: NOW,
  });

  const row = (trainer: string) => plan.rows.find((r) => r.trainer === trainer)!;
  // The due card, plus a direction not yet started of the card that is not due
  // (counted as the trainer's own headline counts it); of three new words the
  // daily limit lets two in.
  assert.deepEqual(row("cards"), { trainer: "cards", review: 2, fresh: 2 });
  assert.deepEqual(row("verbs"), { trainer: "verbs", review: 1, fresh: 1 });
  assert.deepEqual(row("nouns"), { trainer: "nouns", review: 1, fresh: 2 });
  assert.deepEqual(row("otherpos"), { trainer: "otherpos", review: 0, fresh: 0 });
  assert.equal(plan.totalReview, 4);
});

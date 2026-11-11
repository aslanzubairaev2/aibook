// What there is to do today, across every trainer.
//
// Each trainer knew its own queue, and the only way to learn the whole day's
// load was to open five screens and add the numbers up. This reads the same
// schedules those screens read and puts them in one list: reviews first (a
// memory that is about to slip), then how much new material is waiting.
//
// Pure on purpose — the home screen gathers the inputs, this only counts.

import { computeDeckStats, heldBackNewCards, type VariantProgressMap } from "@/lib/cards";
import { drillKeysFor, getDrill, isDrillDue } from "@/lib/srs/drillSchedule";
import type { ModuleProgress } from "@/lib/srs/packProgress";
import { isWordDue } from "@/lib/srs/wordSchedule";
import type { Flashcard } from "@/lib/types";
import type { ConjugationTense, QuizMode } from "@/lib/verbsQuizModes";

export type TodayTrainer = "cards" | "verbs" | "nouns" | "otherpos";

export type TodayRow = {
  trainer: TodayTrainer;
  /** Items already met whose day has come — the part that should not wait. */
  review: number;
  /** Never-met items available to start. */
  fresh: number;
};

export type TodayPlan = {
  rows: TodayRow[];
  /** Sum of `review` — the headline. */
  totalReview: number;
  /** Card repetitions already done today. */
  doneToday: number;
  /** Days in a row with at least one card review. */
  streak: number;
  /** Words that keep slipping, over every trainer. */
  struggling: number;
};

type Entry = { id: string; translation?: string | null; forms?: Record<string, string> | null };

export type TodayInput = {
  cards: Flashcard[];
  variantProgress: VariantProgressMap;
  newPerDay: number;
  verbs: { entries: Entry[]; progress: ModuleProgress; modes: ReadonlySet<QuizMode>; tenses: ReadonlySet<ConjugationTense> };
  nouns: { entries: Entry[]; progress: ModuleProgress };
  otherPos: { entries: Entry[]; progress: ModuleProgress };
  now?: Date;
};

function wordRow(trainer: TodayTrainer, entries: Entry[], progress: ModuleProgress, nowMs: number): TodayRow {
  let review = 0;
  let fresh = 0;
  for (const entry of entries) {
    const state = progress.words[entry.id];
    if (!state) fresh += 1;
    else if (isWordDue(state, nowMs)) review += 1;
  }
  return { trainer, review, fresh };
}

function strugglingWords(progress: ModuleProgress): number {
  // Two or more mistakes, as lib/srs/adaptiveDifficulty.ts counts «сложные».
  return Object.values(progress.words).filter((w) => w.attempts - w.correct >= 2 && !w.ok).length;
}

export function buildTodayPlan(input: TodayInput): TodayPlan {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const held = heldBackNewCards(input.cards, input.newPerDay, now);
  const deck = computeDeckStats(input.cards, input.variantProgress, now, held);
  // Of today's card prompts, the never-seen words are «new», the rest reviews.
  const freshCards = input.cards.filter((c) => c.status === "new" && !c.lastReviewedAt && !held.has(c.id)).length;
  const cardRow: TodayRow = { trainer: "cards", review: Math.max(0, deck.dueReps - freshCards), fresh: freshCards };

  let verbReview = 0;
  let verbFresh = 0;
  for (const entry of input.verbs.entries) {
    const keys = drillKeysFor(entry, input.verbs.modes, input.verbs.tenses);
    if (!keys.length) continue;
    const states = keys.map((key) => getDrill(input.verbs.progress, entry.id, key));
    if (states.every((s) => !s)) verbFresh += 1;
    else if (states.some((s) => s && isDrillDue(s, nowMs))) verbReview += 1;
  }

  const rows: TodayRow[] = [
    cardRow,
    { trainer: "verbs", review: verbReview, fresh: verbFresh },
    wordRow("nouns", input.nouns.entries, input.nouns.progress, nowMs),
    wordRow("otherpos", input.otherPos.entries, input.otherPos.progress, nowMs),
  ];

  return {
    rows,
    totalReview: rows.reduce((sum, row) => sum + row.review, 0),
    doneToday: deck.reviewedToday,
    streak: deck.streak,
    struggling: deck.hardCards
      + strugglingWords(input.verbs.progress)
      + strugglingWords(input.nouns.progress)
      + strugglingWords(input.otherPos.progress),
  };
}

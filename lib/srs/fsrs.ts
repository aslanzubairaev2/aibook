// Spaced repetition on FSRS — the scheduler Anki uses by default.
//
// SM-2 kept one number per prompt (an interval) and multiplied it on every
// answer; it could not tell a word drilled ten times in one evening from one
// remembered across a month, and «Легко» on those drills is what pushed words
// years ahead. FSRS models memory with two numbers:
//   stability  — days until the chance of recalling drops to 90 %;
//   difficulty — 1 (trivial) … 10 (keeps slipping), moved by every answer.
// The next show is when recall is predicted to fall to REQUEST_RETENTION, and
// how much time really passed is part of every update, so an early repeat
// barely moves a word and a forgotten one comes back soon.
//
// Prompts reviewed before the switch have no FSRS state; it is derived once
// from their SM-2 fields at the next review (as Anki does for a deck without
// usable history) and FSRS takes over from there.

import { fsrs, Rating, State, type Card } from "ts-fsrs";
import type { CardStatus } from "@/lib/types";

/** Recall the schedule aims for when a word comes back: 9 of 10 remembered. */
export const REQUEST_RETENTION = 0.9;

const scheduler = fsrs({
  request_retention: REQUEST_RETENTION,
  // Even the easiest word is seen at least once a year — a language is not
  // a quiz deck, and FSRS's own ceiling is a hundred years.
  maximum_interval: 365,
  // Same-day repeats are handled by the session (a forgotten word comes round
  // again before it ends), so FSRS only ever schedules whole days.
  enable_short_term: false,
  // A little jitter so a pack learned together does not all fall due together.
  enable_fuzz: true,
});

/** The three answers: «Забыл», «Помню», «Легко». */
export type ReviewGrade = 1 | 3 | 4;

export const REVIEW_GRADES: ReviewGrade[] = [1, 3, 4];

/** The schedule fields a card, or one direction of it, carries. */
export type MemoryProgress = {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
  lastReviewedAt?: string | null;
  stability?: number | null;
  difficulty?: number | null;
};

export type MemoryUpdate = {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  dueAt: string;
  stability: number;
  difficulty: number;
};

const DAY_MS = 86_400_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Difficulty for a prompt that has none yet. Ease is not trusted upward —
 * drilling with «Легко» inflated it — but a low ease and every lapse do count.
 */
export function difficultyFromSm2(easeFactor: number, lapses: number): number {
  const ease = Number.isFinite(easeFactor) ? easeFactor : 2.5;
  return clamp(5 + Math.max(0, 2.5 - ease) * 7 + Math.min(lapses, 4), 1, 10);
}

function isFresh(p: MemoryProgress): boolean {
  return p.status === "new" && !p.lastReviewedAt && (p.stability ?? null) === null;
}

/** The prompt as ts-fsrs sees it. */
export function toFsrsCard(p: MemoryProgress, now: Date): Card {
  if (isFresh(p)) {
    return {
      due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0,
      learning_steps: 0, reps: 0, lapses: 0, state: State.New,
    };
  }
  const due = new Date(Date.parse(p.dueAt) || now.getTime());
  const interval = Math.max(1, p.intervalDays || 1);
  const lastReview = p.lastReviewedAt
    ? new Date(Date.parse(p.lastReviewedAt))
    : new Date(due.getTime() - interval * DAY_MS);
  // FSRS's stability is exactly the interval at 90 % retention, which is what
  // an SM-2 interval was meant to be — after the repair it is also bounded.
  const stability = p.stability ?? interval;
  const difficulty = p.difficulty ?? difficultyFromSm2(p.easeFactor, p.lapses);
  return {
    due,
    stability: Math.max(0.1, stability),
    difficulty: clamp(difficulty, 1, 10),
    elapsed_days: Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / DAY_MS)),
    scheduled_days: interval,
    learning_steps: 0,
    reps: Math.max(1, p.repetitions),
    lapses: p.lapses,
    state: State.Review,
    last_review: lastReview,
  };
}

function statusOf(state: State, grade: ReviewGrade): CardStatus {
  if (grade === 1) return "relearning";
  if (state === State.New) return "new";
  if (state === State.Learning) return "learning";
  return "review";
}

/** One answer applied to one prompt. */
export function reviewMemory(p: MemoryProgress, grade: ReviewGrade, now: Date = new Date()): MemoryUpdate {
  const { card } = scheduler.next(toFsrsCard(p, now), now, grade as unknown as Exclude<Rating, Rating.Manual>);
  const intervalDays = Math.max(1, card.scheduled_days || Math.round((card.due.getTime() - now.getTime()) / DAY_MS));
  // At least tomorrow: a whole-day scheduler must never hand back «today» —
  // the session itself repeats a forgotten word before it ends.
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const dueMs = Math.max(card.due.getTime(), tomorrow.getTime());
  return {
    status: statusOf(card.state, grade),
    // Consecutive successes, as before — the trainers and «сложные» read it.
    repetitions: grade === 1 ? 0 : p.repetitions + 1,
    lapses: card.lapses,
    intervalDays,
    dueAt: new Date(dueMs).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
  };
}

/** Days until the prompt comes back for each answer — printed on the buttons. */
export function previewIntervals(p: MemoryProgress, now: Date = new Date()): Record<ReviewGrade, number> {
  return {
    1: reviewMemory(p, 1, now).intervalDays,
    3: reviewMemory(p, 3, now).intervalDays,
    4: reviewMemory(p, 4, now).intervalDays,
  };
}

/** Chance of recalling the prompt right now, 0–1; 1 for a prompt never seen. */
export function recallChance(p: MemoryProgress, now: Date = new Date()): number {
  if (isFresh(p)) return 1;
  return scheduler.get_retrievability(toFsrsCard(p, now), now, false);
}

/**
 * «Сложные»: words that keep slipping — high difficulty, or a recent lapse
 * that has not been made good yet. Old lapses are forgiven once later answers
 * have pulled the difficulty back down, which is what a lifetime count of
 * «Забыл» could never do.
 */
export function isStrugglingMemory(p: MemoryProgress): boolean {
  if (isFresh(p) || p.repetitions === 0 && p.lapses === 0) return false;
  const difficulty = p.difficulty ?? difficultyFromSm2(p.easeFactor, p.lapses);
  return difficulty >= 7.5 || p.status === "relearning";
}

/** «3 дн.», «2 мес.», «1,5 г.» — short enough for a button. */
export function formatInterval(days: number): string {
  if (days < 30) return `${days} дн.`;
  if (days < 365) return `${Math.round(days / 30)} мес.`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${String(years).replace(".", ",")} г.`;
}

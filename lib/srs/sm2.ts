import type { Flashcard, SkillProgress } from "@/lib/types";

export type SrsScore = 1 | 2 | 3 | 4; // 1 = Forgot, 2 = Hard, 3 = Good, 4 = Easy

export interface SrsResult {
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
  status: Flashcard["status"];
}

/**
 * The longest a card may wait. Without a ceiling, each «Легко» multiplies the
 * interval by ~3, and a card answered easily a dozen times got due dates in
 * the year 197416 — which Postgres refuses, failing the whole sync batch.
 */
export const MAX_INTERVAL_DAYS = 3650;

/** Pulls an overgrown due date (from before the ceiling existed) back within it. */
export function clampDueAt(dueAt: string, now = new Date()): string {
  const limit = new Date(now);
  limit.setDate(limit.getDate() + MAX_INTERVAL_DAYS);
  const due = Date.parse(dueAt);
  return Number.isFinite(due) && due <= limit.getTime() ? dueAt : limit.toISOString();
}

/** When the card was last reviewed and when it was due — what makes a review early. */
export type ReviewTiming = { lastReviewedAt?: string | null; dueAt?: string | null; now?: Date };

const DAY_MS = 86_400_000;

/** Reviewed before the day it was due (a pack drill, a free run through the deck). */
export function isEarlyReview(timing?: ReviewTiming): boolean {
  if (!timing?.dueAt) return false;
  const due = Date.parse(timing.dueAt);
  const now = (timing.now ?? new Date()).getTime();
  return Number.isFinite(due) && now < due - DAY_MS;
}

function elapsedDays(timing?: ReviewTiming): number {
  const last = timing?.lastReviewedAt ? Date.parse(timing.lastReviewedAt) : NaN;
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, ((timing?.now ?? new Date()).getTime() - last) / DAY_MS);
}

/**
 * Calculates new Spaced Repetition System (SRS) values based on the SM-2 algorithm.
 * 
 * @param score User rating from 1 to 4:
 *              1 - Forgot (Не помню)
 *              2 - Hard (Трудно)
 *              3 - Good (Нормально)
 *              4 - Easy (Легко)
 * @param prevRepetitions Number of consecutive correct reviews
 * @param prevLapses Total times forgotten
 * @param prevIntervalDays Current interval in days
 * @param prevEaseFactor Ease factor (defaults to 2.5)
 */
export function calculateSM2(
  score: SrsScore,
  prevRepetitions: number,
  prevLapses: number,
  prevIntervalDays: number,
  prevEaseFactor: number,
  timing?: ReviewTiming,
): SrsResult {
  let repetitions = prevRepetitions;
  let lapses = prevLapses;
  let intervalDays = Math.min(prevIntervalDays, MAX_INTERVAL_DAYS);
  let easeFactor = prevEaseFactor || 2.5;
  const early = isEarlyReview(timing);
  let status: Flashcard["status"] = "review";

  if (score === 1) {
    // Forgot - complete reset of repetitions
    repetitions = 0;
    lapses += 1;
    intervalDays = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.3);
    status = "relearning";
  } else {
    // Correct response (2, 3, or 4)
    repetitions += 1;

    // Adjust ease factor
    if (score === 2) {
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      status = "learning";
    } else if (score === 4) {
      // Ease grows only on a review that actually waited: drilling a pack ten
      // times in a week said nothing about the word being easy to remember.
      if (!early) easeFactor += 0.15;
      status = "review";
    } else {
      status = "review";
    }

    // Determine interval
    if (repetitions === 1) {
      intervalDays = score === 4 ? 2 : 1;
    } else if (repetitions === 2) {
      intervalDays = score === 4 ? 6 : score === 3 ? 4 : 3;
    } else {
      let multiplier = easeFactor;
      if (score === 2) {
        multiplier *= 0.8;
      } else if (score === 4) {
        multiplier *= 1.2;
      }
      // The interval grows from the time that really passed. A card reviewed
      // before its due date has not survived the scheduled wait, so the
      // scheduled interval must not be multiplied as if it had — that is what
      // pushed cards drilled daily in a pack to intervals of 2 589 949 days.
      // It never shrinks either: an early «Легко» keeps what was earned.
      const base = early ? Math.max(1, elapsedDays(timing)) : intervalDays;
      intervalDays = Math.max(early ? intervalDays : 1, Math.round(base * multiplier));
    }
  }
  intervalDays = Math.min(intervalDays, MAX_INTERVAL_DAYS);

  // Calculate next due date
  const due = new Date();
  due.setDate(due.getDate() + intervalDays);
  // Set time to end of day or standard morning hour to keep things organized, 
  // but just adding days works perfectly.
  due.setHours(23, 59, 59, 999);

  return {
    repetitions,
    lapses,
    intervalDays,
    easeFactor,
    dueAt: due.toISOString(),
    status,
  };
}

/**
 * Initializes a new card with default SM-2 settings.
 */
export function createDefaultSrsFields(sourceBookId?: string | null, sourceBookTitle?: string | null) {
  const due = new Date();
  // Set due time to end of today so it shows up in "Today" review queue immediately
  due.setHours(23, 59, 59, 999);
  
  return {
    status: "new" as const,
    repetitions: 0,
    lapses: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: due.toISOString(),
    lastReviewedAt: null,
    sourceBookId: sourceBookId ?? null,
    sourceBookTitle: sourceBookTitle ?? null,
  };
}

/**
 * Initial SRS state for a productive skill track (recall / listen / produce).
 * New skills are due immediately so they enter the first session.
 */
export function createDefaultSkillProgress(): SkillProgress {
  const due = new Date();
  due.setHours(23, 59, 59, 999);
  return {
    status: "new",
    repetitions: 0,
    lapses: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: due.toISOString(),
    lastReviewedAt: null,
  };
}

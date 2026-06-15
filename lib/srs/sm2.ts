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
  prevEaseFactor: number
): SrsResult {
  let repetitions = prevRepetitions;
  let lapses = prevLapses;
  let intervalDays = prevIntervalDays;
  let easeFactor = prevEaseFactor || 2.5;
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
      easeFactor += 0.15;
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
      intervalDays = Math.max(1, Math.round(intervalDays * multiplier));
    }
  }

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

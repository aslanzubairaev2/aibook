// How well the learner knows the word they just tapped — read off the SRS
// state of their own card for it, with no new tracking and no extra request.
//
// The point is the discussion, not the statistics: a word that has been
// forgotten four times needs a memory hook and two forms, while a word on a
// three-month interval needs nuance and should never be re-explained from
// scratch. Both cases used to get the same textbook paragraph.

import { findDuplicateCard } from "@/lib/cards";
import type { DiscussFamiliarity, DiscussWordProfile, Flashcard } from "@/lib/types";

/**
 * SM-2 starts every card at 2.5 and pushes the ease factor down on each
 * failure. Below this the card has been failed repeatedly, whatever its status
 * says today.
 */
const SHAKY_EASE = 2.2;

/** A card seen this many times without a recent lapse is genuinely known. */
const MASTERED_REPETITIONS = 4;

/** …and held for at least this long between reviews. */
const MASTERED_INTERVAL_DAYS = 21;

function familiarityOf(card: Flashcard): DiscussFamiliarity {
  const { status, repetitions, lapses, intervalDays, easeFactor } = card;

  // Failing repeatedly outranks everything else: a card can sit in "review"
  // and still be the one the learner never gets right.
  if (status === "relearning" || lapses >= 3 || (lapses >= 2 && easeFactor < SHAKY_EASE)) {
    return "struggling";
  }
  if (status === "new" || repetitions === 0) return "new";
  if (
    status === "review" &&
    repetitions >= MASTERED_REPETITIONS &&
    intervalDays >= MASTERED_INTERVAL_DAYS &&
    lapses === 0
  ) {
    return "mastered";
  }
  if (status === "review" && repetitions >= 2) return "familiar";
  return "learning";
}

/** Reads a card's schedule into the shape the discussion prompt takes. */
export function describeCardFamiliarity(card: Flashcard | null | undefined): DiscussWordProfile {
  if (!card) return { familiarity: "unseen" };
  return {
    familiarity: familiarityOf(card),
    status: card.status,
    repetitions: card.repetitions,
    lapses: card.lapses,
    intervalDays: Math.round(card.intervalDays),
    easeFactor: Math.round(card.easeFactor * 100) / 100,
    cefr: card.cefr ?? null,
  };
}

/**
 * The same, starting from the text on screen: the reader has a deck but not
 * the card, so it looks the word up the way the duplicate check does.
 */
export function describeTextFamiliarity(text: string, cards: Flashcard[]): DiscussWordProfile {
  return describeCardFamiliarity(findDuplicateCard(text, cards));
}

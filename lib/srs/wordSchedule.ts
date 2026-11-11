// When a word of the Существительные / other-parts-of-speech trainers comes back.
//
// Those trainers knew one thing about a word — whether its last answer was
// right — so «Тренировать всё» meant every word, every time, however well it
// was already known. A word now also carries an FSRS memory (the scheduler the
// cards and the verb drills use, lib/srs/fsrs.ts): answered right it goes away
// for days, then weeks; answered wrong it is back tomorrow. The pack bars and
// the «Незнакомые» / «Сложные» filters read the same fields as before.
//
// Words answered before this existed have no memory yet: they count as due,
// oldest answer first, and get their schedule at the next answer.

import { reviewMemory, type MemoryProgress } from "@/lib/srs/fsrs";
import type { CardStatus } from "@/lib/types";

export type WordMemory = {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  dueAt: string;
  lastReviewedAt: string;
  stability: number;
  difficulty: number;
};

type Scheduled = { at: number; mem?: WordMemory };

export const DEFAULT_WORD_SESSION_LIMIT = 20;

function asMemory(mem: WordMemory | undefined): MemoryProgress {
  if (!mem) return { status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: new Date(0).toISOString() };
  return { ...mem, easeFactor: 2.5 };
}

/**
 * The word's memory after one answer.
 *
 * A word is asked several things in one session (перевод, артикль, мн. ч.).
 * The session's first answer is the review. A later answer in the same
 * session cannot push the word further out — that would be drilling, not
 * remembering — but a later mistake does count: the word was not known after
 * all, so it is scheduled as forgotten.
 */
export function nextWordMemory(
  prev: WordMemory | undefined,
  correct: boolean,
  firstThisSession: boolean,
  okSoFar: boolean,
  now: number,
): WordMemory | undefined {
  if (!firstThisSession && prev) {
    if (correct || !okSoFar) return prev;
    return { ...reviewMemory(asMemory(prev), 1, new Date(now)), lastReviewedAt: new Date(now).toISOString() };
  }
  return { ...reviewMemory(asMemory(prev), correct ? 3 : 1, new Date(now)), lastReviewedAt: new Date(now).toISOString() };
}

/** Never asked, never scheduled, or its day has come. */
export function isWordDue(state: Scheduled | undefined, now: number = Date.now()): boolean {
  if (!state?.mem) return true;
  const due = Date.parse(state.mem.dueAt);
  return !Number.isFinite(due) || due <= now;
}

/**
 * What one «Повторить» press should ask: the due words — those already met
 * first, longest-waiting first, then words never asked, in dictionary order —
 * cut at `limit` (0 = no limit).
 */
export function planWordSession<E extends { id: string }>(
  entries: E[],
  words: Record<string, Scheduled>,
  limit: number = DEFAULT_WORD_SESSION_LIMIT,
  now: number = Date.now(),
): E[] {
  const ranked = entries
    .filter((entry) => isWordDue(words[entry.id], now))
    .map((entry) => {
      const state = words[entry.id];
      const rank = state?.mem ? Date.parse(state.mem.dueAt) || 0 : state ? state.at : Infinity;
      return { entry, rank, fresh: !state };
    });
  // Stable, so never-asked words keep the dictionary's own order.
  ranked.sort((a, b) => Number(a.fresh) - Number(b.fresh) || a.rank - b.rank);
  return (limit > 0 ? ranked.slice(0, limit) : ranked).map(({ entry }) => entry);
}

/** How many words are waiting — the number on the button. */
export function countDueWords(entries: Array<{ id: string }>, words: Record<string, Scheduled>, now: number = Date.now()): number {
  return entries.filter((entry) => isWordDue(words[entry.id], now)).length;
}

/** Of the due words, how many have been met before — «повторить», as opposed to «новые». */
export function countDueSeenWords(entries: Array<{ id: string }>, words: Record<string, Scheduled>, now: number = Date.now()): number {
  return entries.filter((entry) => words[entry.id] && isWordDue(words[entry.id], now)).length;
}

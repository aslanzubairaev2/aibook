// What "Обсудить с AI" knows about the learner beyond the tapped item.
//
// Before this, the only memory the chat had was a list of grammar patterns it
// had itself explained before — and since every German sentence contains a
// verb in second position, that one pattern kept topping the list and the
// tutor kept opening with "вы уже встречали это правило". The learner read
// that as the chat knowing exactly one thing about them, which was true.
//
// This snapshot hands the tutor the things that actually describe *this*
// learner: the words they keep failing, the words they saved this week, how
// big their working vocabulary is, and which book they are in. All of it is
// already stored locally — no new tracking, no extra request.

import { describeCardFamiliarity } from "@/lib/ai/wordProfile";
import type { Book, DiscussLearnerSnapshot, Flashcard } from "@/lib/types";

const MAX_WORDS = 8;
const MAX_WORD_CHARS = 40;
const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/** Cards hold words, phrases and whole sentences; only the short ones work as "use this word" hints. */
function usableFront(card: Flashcard): string | null {
  const front = card.front?.trim();
  if (!front || front.length > MAX_WORD_CHARS) return null;
  return front;
}

export function buildLearnerSnapshot(
  cards: Flashcard[],
  books: Book[],
  targetLanguage: string,
  selectedText: string,
  now: number = Date.now(),
): DiscussLearnerSnapshot {
  const selected = normalise(selectedText);
  const notSelected = (front: string) => normalise(front) !== selected;

  const struggling = cards
    .filter((card) => describeCardFamiliarity(card).familiarity === "struggling" || (card.difficulty ?? 0) >= 7)
    .sort((a, b) => (b.lapses - a.lapses) || ((b.difficulty ?? 0) - (a.difficulty ?? 0)))
    .map(usableFront)
    .filter((front): front is string => !!front && notSelected(front));

  const recent = cards
    .filter((card) => {
      const added = Date.parse(card.addedAt);
      return Number.isFinite(added) && now - added <= RECENT_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .map(usableFront)
    .filter((front): front is string => !!front && notSelected(front) && !struggling.includes(front));

  const known = cards.filter((card) => {
    const familiarity = describeCardFamiliarity(card).familiarity;
    return familiarity === "familiar" || familiarity === "mastered";
  }).length;

  const book = books
    .filter((b) => b.language === targetLanguage && b.progress > 0 && b.progress < 100)
    .sort((a, b) => (Date.parse(b.lastReadAt) || 0) - (Date.parse(a.lastReadAt) || 0))[0];

  const snapshot: DiscussLearnerSnapshot = {};
  if (struggling.length) snapshot.strugglingWords = struggling.slice(0, MAX_WORDS);
  if (recent.length) snapshot.recentWords = recent.slice(0, MAX_WORDS);
  if (cards.length) {
    snapshot.totalWordCount = cards.length;
    snapshot.knownWordCount = known;
  }
  if (book) {
    snapshot.currentBook = {
      title: book.title,
      ...(book.author ? { author: book.author } : {}),
      progress: Math.round(book.progress),
      ...(book.chapterTitle ? { chapter: book.chapterTitle } : {}),
      cefr: book.cefrLevel ?? null,
    };
  }
  return snapshot;
}

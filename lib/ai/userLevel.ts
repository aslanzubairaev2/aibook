// Estimates the learner's proficiency in their target language from data
// already stored locally (no server round-trip, no new user-facing setting):
// the CEFR level of books they've read, and the size of their flashcard deck
// as a fallback vocabulary-size heuristic.

import { getLocalBooks, getLocalCards } from "@/lib/db/local";
import type { CefrLevel } from "@/lib/types";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const VOCAB_SIZE_THRESHOLDS: [number, CefrLevel][] = [
  [80, "A1"],
  [250, "A2"],
  [600, "B1"],
  [1200, "B2"],
  [2500, "C1"],
];

function levelFromVocabSize(size: number): CefrLevel {
  for (const [max, level] of VOCAB_SIZE_THRESHOLDS) {
    if (size < max) return level;
  }
  return "C2";
}

function highestLevel(levels: CefrLevel[]): CefrLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, level) =>
    CEFR_ORDER.indexOf(level) > CEFR_ORDER.indexOf(best) ? level : best
  );
}

export type TargetLevelEstimate = {
  level: CefrLevel;
  /** Short free-text summary to drop into the Live Chat system prompt. */
  summary: string;
};

/** Looks at books and flashcards for `targetLanguage` to estimate the learner's CEFR level. */
export async function estimateTargetLanguageLevel(targetLanguage: string): Promise<TargetLevelEstimate | null> {
  const [books, cards] = await Promise.all([getLocalBooks(), Promise.resolve(getLocalCards())]);

  const targetBooks = books.filter((b) => b.language === targetLanguage);
  const readBooks = targetBooks.filter((b) => b.progress > 0);
  const finishedBooks = targetBooks.filter((b) => b.progress >= 95);
  const bookLevels = readBooks
    .map((b) => b.cefrLevel)
    .filter((l): l is CefrLevel => !!l);

  const vocabSize = cards.length;
  const matureVocabSize = cards.filter((c) => c.status === "review" && c.repetitions >= 2).length;

  const fromBooks = highestLevel(bookLevels);
  const fromVocab = vocabSize > 0 ? levelFromVocabSize(vocabSize) : null;

  const level = fromBooks ?? fromVocab;
  if (!level) return null;

  const parts: string[] = [];
  if (finishedBooks.length > 0) parts.push(`has finished ${finishedBooks.length} book(s)`);
  else if (readBooks.length > 0) parts.push(`is currently reading ${readBooks.length} book(s)`);
  if (bookLevels.length > 0) parts.push(`those books are around ${fromBooks} level`);
  if (vocabSize > 0) parts.push(`has ${vocabSize} vocabulary flashcards saved (${matureVocabSize} of them well-learned)`);

  const summary = `Estimated level ${level} (CEFR)${parts.length ? ", " + parts.join(", ") : ""}.`;

  return { level, summary };
}

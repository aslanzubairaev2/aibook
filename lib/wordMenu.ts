// The right-click word menu: what was clicked, and which flashcards it has.
//
// Any element in the app opts in with data attributes, so the menu works on
// every screen without each one wiring its own handler:
//
//   data-word="öffnen"          the word itself (a dictionary headword, a card front)
//   data-word-context="…"       the text around a tappable token — reader,
//                               homework, videos, chat already carry it; the
//                               token's own text is then the word
//   data-phrase="…"             an ancestor that is a phrase or sentence (a card row)
//   data-card-id / data-phrase-card-id   when the element already knows its card
//
// Kept DOM-light and pure where it can be, so the matching rules are tested.

import type { Flashcard } from "@/lib/types";

export type WordMenuTarget = {
  word: string | null;
  phrase: string | null;
  wordCardId?: string;
  phraseCardId?: string;
};

const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|the|a|an|le|la|les|l'|el|los|las)\s+/iu;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Lower-cased, single-spaced, without punctuation at either end. */
export function normalizeForMatch(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "").toLocaleLowerCase();
}

function withoutArticle(text: string): string {
  return normalizeForMatch(text).replace(ARTICLE, "");
}

function wordCount(text: string): number {
  return normalizeForMatch(text).split(" ").filter(Boolean).length;
}

/** A phrase block only makes sense for more than one word — «der Drucker» is still one. */
export function isPhrase(text: string | null | undefined): boolean {
  return Boolean(text) && withoutArticle(text!).split(" ").filter(Boolean).length > 1;
}

/**
 * The card for one word: the exact front first, then the same word with or
 * without its article — «Drucker» in a sentence finds «der Drucker».
 */
export function findWordCard(word: string, cards: Flashcard[]): Flashcard | null {
  const exact = normalizeForMatch(word);
  if (!exact) return null;
  const bare = withoutArticle(word);
  let byArticle: Flashcard | null = null;
  for (const card of cards) {
    const front = normalizeForMatch(card.front);
    if (front === exact) return card;
    if (!byArticle && wordCount(card.front) <= 2 && withoutArticle(card.front) === bare) byArticle = card;
  }
  return byArticle;
}

/**
 * The card for the phrase around a word: a card whose front is the phrase
 * itself, or the longest multi-word card that sits inside the phrase and holds
 * the clicked word — «den Drucker anschließen» inside a whole reader sentence.
 */
export function findPhraseCard(phrase: string, word: string | null, cards: Flashcard[]): Flashcard | null {
  const text = ` ${normalizeForMatch(phrase).replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ")} `;
  const clicked = word ? normalizeForMatch(word) : "";
  let best: Flashcard | null = null;
  let bestLength = 0;
  for (const card of cards) {
    if (!isPhrase(card.front)) continue;
    const front = normalizeForMatch(card.front).replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ");
    if (!text.includes(` ${front} `)) continue;
    if (clicked && !` ${front} `.includes(` ${clicked} `)) continue;
    if (front.length > bestLength) { best = card; bestLength = front.length; }
  }
  return best;
}

/** The sentence of a longer text that holds the word — what the phrase block shows. */
export function sentenceAround(text: string, word: string | null): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*/gu) ?? [text];
  if (!word) return sentences[0].trim();
  const needle = normalizeForMatch(word);
  const hit = sentences.find((s) => normalizeForMatch(s).split(/[^\p{L}\p{N}']+/u).includes(needle));
  return (hit ?? sentences[0]).trim();
}

/** Reads the target from the element under the pointer, or null when it is not a word or phrase. */
export function readWordMenuTarget(start: Element): WordMenuTarget | null {
  const wordEl = start.closest<HTMLElement>("[data-word], [data-word-context]");
  const phraseEl = start.closest<HTMLElement>("[data-phrase]");
  if (!wordEl && !phraseEl) return null;

  const word = wordEl
    ? (wordEl.dataset.word ?? wordEl.dataset.wordText ?? wordEl.textContent ?? "").trim()
    : "";
  const context = wordEl && wordEl.dataset.word === undefined ? wordEl.dataset.wordContext ?? null : null;
  const rawPhrase = phraseEl?.dataset.phrase ?? (context ? sentenceAround(context, word) : null);
  const phrase = isPhrase(rawPhrase) ? rawPhrase!.trim() : null;
  const cleanWord = normalizeForMatch(word) ? word.replace(EDGE_PUNCTUATION, "") : null;
  if (!cleanWord && !phrase) return null;

  return {
    word: cleanWord,
    phrase,
    wordCardId: wordEl?.dataset.cardId,
    phraseCardId: phraseEl?.dataset.phraseCardId,
  };
}

// ─── Flashcard preview ───────────────────────────────────────────────────────
// One event, so any screen (the menu, a card row) can show a card read-only
// without threading a callback through every component in between.

export const FLASHCARD_PREVIEW_EVENT = "aibook:preview-flashcard";

export function openFlashcardPreview(cardId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(FLASHCARD_PREVIEW_EVENT, { detail: cardId }));
}

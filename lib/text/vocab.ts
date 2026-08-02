// Vocabulary coverage: what share of the running words in a text the learner
// already has in their flashcard deck.
//
// This drives the "i+1" idea behind graded reading — a text is productive when
// roughly one word in ten is new. Below ~90% known the reader stalls looking
// things up; above ~98% there is nothing left to learn. So the useful signal is
// not "hard/easy" but "how close is this to your current vocabulary".
//
// Everything here is arithmetic over data the app already has: the deck and the
// text. No model call is involved.

/** Share of running words that must be known for a text to be worth reading. */
export const COMFORT_MIN = 0.90;
/** Above this the text is mostly review — still readable, but little is new. */
export const COMFORT_MAX = 0.98;

/**
 * Only the most frequent words of a text are stored (see buildWordCounts).
 * The tail is long and individually rare, so leaving it out shifts coverage by
 * little — and always downwards, which is the safe direction for a "can I read
 * this" signal.
 */
export const STORED_WORD_LIMIT = 400;

export type WordCounts = Record<string, number>;

export type TextVocabStats = {
  /** word → occurrences, for the most frequent words only. */
  wordCounts: WordCounts;
  /** Every running word in the text, including ones outside wordCounts. */
  tokenTotal: number;
};

/**
 * Strip everything that is not a letter and lowercase.
 *
 * Matches normalizeToken in lib/selector/text.ts, which is what the reader uses
 * when a word is tapped and saved to the deck — the two have to agree or
 * nothing would ever match. Digits are dropped here (a text full of years
 * should not count as known vocabulary).
 */
export function normalizeWord(raw: string): string {
  return raw.replace(/[^\p{L}-]/gu, "").toLowerCase();
}

/**
 * German inflects heavily, and a deck entry ("die Blume") rarely appears in a
 * text in exactly that form ("Blumen"). Matching only exact forms would
 * under-report coverage badly.
 *
 * These are the endings that are safe to strip: common noun plurals, adjective
 * agreement, and weak verb person endings. It is deliberately shallow — a real
 * stemmer would also fold "Bäume" onto "Baum", but guessing umlaut changes
 * produces false matches, which is the worse error here: claiming the reader
 * knows a word they do not.
 */
const SUFFIXES = ["en", "er", "es", "em", "e", "n", "s"];

/** The stem plus every form that could reduce to it, cheapest first. */
export function wordVariants(word: string): string[] {
  const variants = [word];
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      variants.push(word.slice(0, -suffix.length));
    }
  }
  return variants;
}

/** Split a text into normalized running words, dropping empties. */
export function tokenizeWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s—–-]+/)) {
    const word = normalizeWord(raw);
    // Single letters are articles/initials, not vocabulary worth counting.
    if (word.length > 1) out.push(word);
  }
  return out;
}

/** Frequency table for a text, capped at STORED_WORD_LIMIT entries. */
export function buildWordCounts(text: string, limit = STORED_WORD_LIMIT): TextVocabStats {
  const tokens = tokenizeWords(text);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const wordCounts: WordCounts = {};
  for (const [word, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    wordCounts[word] = count;
  }

  return { wordCounts, tokenTotal: tokens.length };
}

/**
 * The metadata keys every import writes onto a text.
 *
 * Kept here so the three write sites (Klexikon, UniversalCEFR, generated
 * lessons) and the backfill cannot drift apart in key naming — the reader would
 * silently see no coverage if they did.
 */
export function vocabMetadata(text: string): { word_counts: WordCounts; token_total: number } {
  const stats = buildWordCounts(text);
  return { word_counts: stats.wordCounts, token_total: stats.tokenTotal };
}

/**
 * The learner's known forms, as a lookup set.
 *
 * A deck entry can be a phrase ("guten Morgen") — each of its words counts, since
 * meeting any of them in a text is not new. Both the entry as written and its
 * de-inflected stem go in, so "die Blume" matches "Blumen" in a text.
 */
export function buildKnownWordSet(deckEntries: string[]): Set<string> {
  const known = new Set<string>();
  for (const entry of deckEntries) {
    for (const word of tokenizeWords(entry)) {
      for (const variant of wordVariants(word)) known.add(variant);
    }
  }
  return known;
}

export type Coverage = {
  /** 0..1 — share of running words the learner already knows. */
  ratio: number;
  /** Running words not in the deck, among the stored (frequent) ones. */
  unknownTokens: number;
  /** True when the text sits in the productive band for this learner. */
  isComfortable: boolean;
};

/**
 * Coverage of one text against one deck.
 *
 * Returns null when the text has no stored frequency data — an honest "unknown"
 * rather than a fabricated 0%, so the UI can hide the badge instead of telling
 * the learner they know nothing.
 */
export function computeCoverage(
  stats: { wordCounts?: WordCounts | null; tokenTotal?: number | null } | null | undefined,
  knownWords: Set<string>,
): Coverage | null {
  const counts = stats?.wordCounts;
  const total = stats?.tokenTotal;
  if (!counts || !total || total <= 0) return null;

  let knownTokens = 0;
  let unknownTokens = 0;
  for (const [word, count] of Object.entries(counts)) {
    const isKnown = wordVariants(word).some((variant) => knownWords.has(variant));
    if (isKnown) knownTokens += count;
    else unknownTokens += count;
  }

  const ratio = knownTokens / total;
  return {
    ratio,
    unknownTokens,
    isComfortable: ratio >= COMFORT_MIN && ratio <= COMFORT_MAX,
  };
}

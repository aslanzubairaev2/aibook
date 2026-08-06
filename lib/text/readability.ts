// Estimating how hard a text is to read, without asking a model.
//
// Used wherever a text arrives with no CEFR label of its own: Klexikon
// articles, and documents the learner photographs. It is an estimate and the
// UI says so — it sorts texts onto roughly the right shelf, it does not
// replace a human rating.

export type CefrBand = "A1" | "A2" | "B1" | "B2" | "C1";

// LIX (Läsbarhetsindex) = words/sentences + (words longer than 6 chars) * 100 / words.
// It is the standard readability index for German and needs no syllable
// counting, which is what makes it usable on arbitrary scraped or photographed
// text.
//
// The bands below are tuned for German specifically: compounding inflates the
// long-word ratio compared to the Scandinavian languages LIX was designed for,
// so the thresholds sit higher than the classic 30/40/50/60 scale.
const LIX_BANDS: [number, CefrBand][] = [
  [28, "A1"],
  [38, "A2"],
  [48, "B1"],
  [58, "B2"],
];

export function estimateCefrFromLix(lix: number): CefrBand {
  for (const [max, level] of LIX_BANDS) {
    if (lix < max) return level;
  }
  return "C1";
}

export function computeLix(text: string): number {
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return 0;
  // Abbreviations ("z. B.", "u. a.") would each count as a sentence end; require
  // the period to be followed by whitespace and a capital letter or end of text.
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s+\p{Lu}|\s*$)/gu) ?? []).length);
  const longWords = words.filter((w) => w.replace(/[^\p{L}]/gu, "").length > 6).length;
  return words.length / sentences + (longWords * 100) / words.length;
}

/** Readability-based CEFR estimate for a text, with the raw index alongside. */
export function estimateLevel(text: string): { level: CefrBand; lix: number } {
  const lix = computeLix(text);
  return { level: estimateCefrFromLix(lix), lix: Math.round(lix * 10) / 10 };
}

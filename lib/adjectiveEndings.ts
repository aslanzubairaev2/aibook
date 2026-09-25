// Shared logic for the adjective half of "Предлоги и прилагательные": the
// ending an attributive German adjective takes before a noun. This is not
// lexical data — it is a fixed three-table grammatical rule (schwach /
// gemischt / stark) that applies to every adjective the same way, so it is a
// pure lookup rather than something stored per dictionary entry.

import { normalizePos } from "@/lib/verbForms";
import type { NounGender } from "@/lib/nounForms";

/** Which kind of word (if any) stands in front of the adjective. */
export type ArticleType =
  | "der"   // definite article / dieser, jeder, welcher... → schwache Deklination
  | "ein"   // indefinite article / kein, mein, dein... → gemischte Deklination
  | "none"; // no article at all → starke Deklination

export type GrammCase = "nom" | "akk" | "dat" | "gen";

export const ARTICLE_TYPE_ORDER: ArticleType[] = ["der", "ein", "none"];

export const ARTICLE_TYPE_LABEL: Record<ArticleType, string> = {
  der: "der / die / das / dieser...",
  ein: "ein / kein / mein...",
  none: "без артикля",
};

export const CASE_LABEL_FULL: Record<GrammCase, string> = {
  nom: "Nominativ",
  akk: "Akkusativ",
  dat: "Dativ",
  gen: "Genitiv",
};

/**
 * Whether an entry is an adjective — trusting the stored part-of-speech.
 * As with prepositions there is nothing else on the row that would hint at
 * it, so a blank field just means "not shown here".
 */
export function isAdjectiveEntry(entry: { part_of_speech: string; content_type?: string }): boolean {
  if (entry.content_type && entry.content_type !== "word") return false;
  return normalizePos(entry.part_of_speech).includes("прилагательн");
}

// ─── The three declension tables ───────────────────────────────────────────
//
// Rows: case. Columns: gender (masc/fem/neut) or plural. One table per
// article type — the standard shape every German grammar reference prints.

const WEAK_ENDINGS: Record<GrammCase, Record<NounGender, string>> = {
  // der Mann, die Frau, das Kind, die Leute
  nom: { m: "e", f: "e", n: "e", pl: "en" },
  akk: { m: "en", f: "e", n: "e", pl: "en" },
  dat: { m: "en", f: "en", n: "en", pl: "en" },
  gen: { m: "en", f: "en", n: "en", pl: "en" },
};

const MIXED_ENDINGS: Record<GrammCase, Record<NounGender, string>> = {
  // ein Mann, eine Frau, ein Kind, keine Leute
  nom: { m: "er", f: "e", n: "es", pl: "en" },
  akk: { m: "en", f: "e", n: "es", pl: "en" },
  dat: { m: "en", f: "en", n: "en", pl: "en" },
  gen: { m: "en", f: "en", n: "en", pl: "en" },
};

const STRONG_ENDINGS: Record<GrammCase, Record<NounGender, string>> = {
  // no article at all: guter Wein, frische Milch, kaltes Wasser, alte Leute
  nom: { m: "er", f: "e", n: "es", pl: "e" },
  akk: { m: "en", f: "e", n: "es", pl: "e" },
  dat: { m: "em", f: "er", n: "em", pl: "en" },
  gen: { m: "en", f: "er", n: "en", pl: "er" },
};

const ENDINGS_BY_ARTICLE_TYPE: Record<ArticleType, Record<GrammCase, Record<NounGender, string>>> = {
  der: WEAK_ENDINGS,
  ein: MIXED_ENDINGS,
  none: STRONG_ENDINGS,
};

/** The one ending that fits this combination — the quiz answer itself. */
export function adjectiveEnding(articleType: ArticleType, grammCase: GrammCase, gender: NounGender): string {
  return ENDINGS_BY_ARTICLE_TYPE[articleType][grammCase][gender];
}

// ─── The article word itself ───────────────────────────────────────────────
//
// What actually gets shown in front of the adjective in a generated frame.
// "ein" has no plural, so "kein(e)" stands in for it — the same forms a
// learner would use for "keine Bücher" — and "none" prints nothing.

const DER_WORDS: Record<GrammCase, Record<NounGender, string>> = {
  nom: { m: "der", f: "die", n: "das", pl: "die" },
  akk: { m: "den", f: "die", n: "das", pl: "die" },
  dat: { m: "dem", f: "der", n: "dem", pl: "den" },
  gen: { m: "des", f: "der", n: "des", pl: "der" },
};

const EIN_WORDS: Record<GrammCase, Record<NounGender, string>> = {
  nom: { m: "ein", f: "eine", n: "ein", pl: "keine" },
  akk: { m: "einen", f: "eine", n: "ein", pl: "keine" },
  dat: { m: "einem", f: "einer", n: "einem", pl: "keinen" },
  gen: { m: "eines", f: "einer", n: "eines", pl: "keiner" },
};

/** The article word shown before the adjective — empty for `articleType: "none"`. */
export function articleWordFor(articleType: ArticleType, grammCase: GrammCase, gender: NounGender): string {
  if (articleType === "none") return "";
  return (articleType === "der" ? DER_WORDS : EIN_WORDS)[grammCase][gender];
}

export function adjectiveEndingHint(articleType: ArticleType): string {
  switch (articleType) {
    case "der":
      return "После der/die/das и подобных слов (dieser, jeder, welcher) — «слабое» склонение: почти всегда -e или -en.";
    case "ein":
      return "После ein/kein/mein и подобных притяжательных — «смешанное» склонение: путаница только в Nominativ и Akkusativ единственного числа.";
    case "none":
      return "Без артикля прилагательное само показывает род и падеж — «сильное» склонение, как у самого артикля.";
  }
}

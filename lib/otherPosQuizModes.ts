// The two drills behind "Предлоги и прилагательные". Unlike the noun/verb
// trainers these are two genuinely different mechanics (a closed multiple
// choice over stored words vs. a generated grammar frame), so they get their
// own mode types instead of sharing one.

import { ARTICLE_TYPE_ORDER, articleWordFor, type ArticleType, type GrammCase } from "@/lib/adjectiveEndings";
import { GENDER_ORDER, type NounGender } from "@/lib/nounForms";

export type OtherPosCategory = "prepositions" | "adjectives";

export const OTHER_POS_CATEGORY_ORDER: OtherPosCategory[] = ["prepositions", "adjectives"];

export const OTHER_POS_CATEGORY_LABEL: Record<OtherPosCategory, string> = {
  prepositions: "Предлоги",
  adjectives: "Прилагательные",
};

/** How many random case/gender frames each adjective gets in one session. */
export const ADJECTIVE_FRAMES_PER_WORD = 3;

/** One generated question for the adjective-ending drill. */
export type AdjectiveFrame = {
  articleType: ArticleType;
  grammCase: GrammCase;
  gender: NounGender;
  /** The noun the ending is agreeing with — from the learner's own dictionary when possible. */
  noun: string;
  /** der/die/das/den/dem/... — the article shown before the adjective, empty for `articleType: "none"`. */
  article: string;
};

const GRAMM_CASE_ORDER: GrammCase[] = ["nom", "akk", "dat", "gen"];

/** Used when the learner's own dictionary has no noun of the gender a frame needs. */
export const FALLBACK_NOUNS_BY_GENDER: Record<NounGender, string[]> = {
  m: ["Mann", "Tisch", "Hund"],
  f: ["Frau", "Tasche", "Blume"],
  n: ["Kind", "Buch", "Auto"],
  pl: ["Leute", "Bücher", "Kinder"],
};

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** One randomly generated case/gender/article combination for an adjective drill. */
export function randomAdjectiveFrame(nounsByGender: Record<NounGender, string[]>): AdjectiveFrame {
  const articleType = pickRandom(ARTICLE_TYPE_ORDER);
  const grammCase = pickRandom(GRAMM_CASE_ORDER);
  const gender = pickRandom(GENDER_ORDER);
  const pool = nounsByGender[gender]?.length ? nounsByGender[gender] : FALLBACK_NOUNS_BY_GENDER[gender];
  return {
    articleType,
    grammCase,
    gender,
    noun: pickRandom(pool),
    article: articleWordFor(articleType, grammCase, gender),
  };
}

/** Fisher–Yates, used by both quizzes to mix generated/stored steps without repeats clumping. */
export function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

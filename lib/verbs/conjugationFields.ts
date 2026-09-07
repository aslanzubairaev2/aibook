import { fetchGrammar } from "@/lib/ai/grammar";
import { makeGrammarCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalGrammar, saveLocalGrammar } from "@/lib/db/local";
import { toRows } from "@/components/word-modal/GrammarModal";
import type { ConjugationTense } from "@/lib/verbsQuizModes";

export type ConjugationField = { key: string; label: string; expected: string };

// 1sg, 2sg, 3sg, 1pl, 2pl, 3pl — the fixed person order the grammar prompt
// always uses, so the full matrix's rows (which give a whole phrase, not a
// separate pronoun field like the brief table does) can still be labelled.
export const CONJUGATION_PRONOUNS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
// Row index of each tense in the full grammar matrix: Präteritum, Perfekt,
// Präsens, Future, in that fixed order.
export const CONJUGATION_TENSE_ROW: Record<ConjugationTense, number> = { preteritum: 0, perfekt: 1, present: 2, future: 3 };
const AFFIRMATION_COLUMN = 1;

// The full matrix writes each cell as a complete sentence starting with its
// subject ("ich habe gesungen") — but the field's own label already says
// "ich", so repeating it in the answer would just be retyping the label.
// The person is always the sentence's first word in an affirmative statement,
// so dropping it is a plain "cut the first token" rather than needing to know
// which exact pronoun the model chose for 3rd person (er/sie/es).
export function stripLeadingPronoun(phrase: string): string {
  const parts = phrase.trim().split(/\s+/);
  return parts.slice(1).join(" ");
}

/**
 * One tense's worth of conjugation fields for a verb — the cheap "brief"
 * table (a bare conjugated word, "singe") for the present, one row of the
 * "full" matrix (a stripped sentence, "habe gesungen") for the others. Reads
 * through the same cache the grammar modal's own tabs fill, so a verb looked
 * up there once needs no network call here at all.
 */
export async function fetchConjugationFields(
  lemma: string | undefined,
  headword: string,
  tense: ConjugationTense,
  targetLanguage: string,
  nativeLanguage: string,
): Promise<ConjugationField[]> {
  if (tense === "present") {
    const cacheKey = makeGrammarCacheKey(lemma || headword, "brief", targetLanguage, nativeLanguage);
    let table = getLocalGrammar(cacheKey);
    if (!table) {
      try {
        table = await fetchGrammar({ word: headword, lemma, posTag: "verb", targetLanguage, nativeLanguage, detail: "brief" });
        saveLocalGrammar(cacheKey, table);
      } catch {
        table = null;
      }
    }
    const cells = table?.sections?.[0]?.cells ?? [];
    return cells
      .filter((c) => c.pronoun?.trim() && c.form.trim())
      .map((c) => ({ key: `${tense}-${c.pronoun}`, label: c.pronoun!, expected: c.form }));
  }

  const cacheKey = makeGrammarCacheKey(lemma || headword, "full", targetLanguage, nativeLanguage);
  let table = getLocalGrammar(cacheKey);
  if (!table) {
    try {
      table = await fetchGrammar({ word: headword, lemma, posTag: "verb", targetLanguage, nativeLanguage, detail: "full" });
      saveLocalGrammar(cacheKey, table);
    } catch {
      table = null;
    }
  }
  const rowIndex = CONJUGATION_TENSE_ROW[tense];
  const cell = table?.matrix?.cells?.[rowIndex]?.[AFFIRMATION_COLUMN];
  return toRows(cell)
    .map((p, i) => ({ key: `${tense}-${i}`, label: CONJUGATION_PRONOUNS[i] ?? p.form, expected: stripLeadingPronoun(p.form) }))
    .filter((f) => f.expected);
}

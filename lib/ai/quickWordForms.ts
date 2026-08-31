import type { WordAnalysis } from "@/lib/types";

function kind(word: WordAnalysis) {
  if (word.posTag) return word.posTag;
  if (word.verbDetails?.infinitive) return "verb";
  if (word.nounDetails?.article || word.nounDetails?.plural) return "noun";
  return "other";
}

export function hasQuickWordForms(word: WordAnalysis): boolean {
  if (kind(word) === "verb") {
    return Boolean(word.verbDetails?.infinitive && word.verbDetails.praeteritum && word.verbDetails.partizip2);
  }
  if (kind(word) === "noun") return Boolean(word.nounDetails?.singular && word.nounDetails.plural);
  return true;
}

/** No tense names, pronouns, auxiliary verbs or closing instructions. */
export function quickWordForms(word?: WordAnalysis): string {
  if (!word) return "";
  if (kind(word) === "verb") {
    return [word.verbDetails?.infinitive, word.verbDetails?.praeteritum, word.verbDetails?.partizip2].filter(Boolean).join(" - ");
  }
  if (kind(word) === "noun") {
    return [word.nounDetails?.singular || word.lemma, word.nounDetails?.plural].filter(Boolean).join(" - ");
  }
  return "";
}

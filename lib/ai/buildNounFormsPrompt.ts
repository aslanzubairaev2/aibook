// Backfilling the article, gender and plural of a noun the learner already has
// in their dictionary but that was saved without them — typed in by hand, added
// by an assistant, or read from a photo where the model missed the article.
//
// Asks for exactly the columns `DictionaryEntry` already has (`gender`,
// `article`, `plural`), so nothing downstream — the noun table, the gender
// colours, the article drill — needs to change once the answer comes back.

export type NounFormsPromptParams = {
  lemma: string;
  headword: string;
  targetLanguage: string;
  nativeLanguage: string;
};

export function buildNounFormsPrompt(p: NounFormsPromptParams): string {
  const word = p.lemma || p.headword;

  return `You are an expert ${p.targetLanguage} grammar engine. Give the grammatical gender and plural of ONE noun.

Noun: "${word}"
Treat this strictly as a "${p.targetLanguage}" word.

Return an object with:
- "gender": exactly "m", "f", "n", or "pl" (for a plural-only noun such as "die Eltern"). Empty string if "${word}" is not a noun.
- "article": the definite article in the nominative singular — for German exactly "der", "die" or "das". For a plural-only noun, "die".
- "plural": the full plural form written out, with its article: for "der Ball" that is "die Bälle", for "die Lösung" that is "die Lösungen". Empty string if the noun has no plural.

Rules:
- Every form must be written in ${p.targetLanguage}, spelled exactly as a native dictionary would print it (correct umlauts, ß, etc.).
- "gender" and "article" must agree: m → der, f → die, n → das, pl → die.
- Never invent a word that does not exist — if "${word}" is not a real ${p.targetLanguage} noun, return every field as an empty string.

Return ONLY valid JSON, no markdown:
{ "gender": "…", "article": "…", "plural": "…" }`;
}

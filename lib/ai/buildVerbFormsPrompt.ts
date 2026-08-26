// Backfilling principal parts for a verb the learner already has in their
// dictionary but that was saved without them — typed in by hand, added by an
// assistant, or read from a photo where the model missed them. Asks for
// exactly the shape `DictionaryEntry.forms` already uses everywhere else, so
// nothing downstream (isIrregularGermanVerb, FORM_LABEL, the verb table)
// needs to change once the answer comes back.

export type VerbFormsPromptParams = {
  lemma: string;
  headword: string;
  targetLanguage: string;
  nativeLanguage: string;
};

export function buildVerbFormsPrompt(p: VerbFormsPromptParams): string {
  const word = p.lemma || p.headword;

  return `You are an expert ${p.targetLanguage} grammar engine. Give the principal parts of ONE verb.

Verb (infinitive): "${word}"
Treat this strictly as a "${p.targetLanguage}" word.

Return an object with:
- "praeteritum": the simple past / preterite form (for German: 3rd person singular, e.g. "ging" for "gehen").
- "partizip2": the past participle (for German: e.g. "gegangen").
- "hilfsverb": the auxiliary verb used to build the compound past tense — for German exactly "haben" or "sein". For a language with no such auxiliary distinction, use the closest equivalent or an empty string.
- "trennbar": for German, "да" if the verb is separable (trennbar), "нет" otherwise. For a language without separable verbs, empty string.

Rules:
- Every form must be written in ${p.targetLanguage}, spelled exactly as a native dictionary would print it (correct umlauts, ß, etc.).
- If the verb has no distinct simple-past or participle form in ${p.targetLanguage} (irregular/defective cases aside), still give the standard form a native speaker would produce.
- Never invent a verb that does not exist — if "${word}" is not a real ${p.targetLanguage} verb, return every field as an empty string.

Return ONLY valid JSON, no markdown:
{ "praeteritum": "…", "partizip2": "…", "hilfsverb": "…", "trennbar": "…" }`;
}

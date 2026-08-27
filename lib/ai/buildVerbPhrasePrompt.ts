// One short example sentence for the "phrases" verb-quiz drill: the learner
// sees it in their own language and has to produce the target-language
// version, so what's needed is exactly one sentence in each language, tied
// together — not the whole dictionary-entry shape buildDictionaryPrompt asks
// for when reading a photographed page.

export type VerbPhrasePromptParams = {
  lemma: string;
  headword: string;
  targetLanguage: string;
  nativeLanguage: string;
};

export function buildVerbPhrasePrompt(p: VerbPhrasePromptParams): string {
  const word = p.lemma || p.headword;

  return `You are writing one example sentence for a language-learning drill.

Verb (infinitive): "${word}" — a ${p.targetLanguage} word.
Learner's native language: ${p.nativeLanguage}.

Write ONE short, natural, everyday sentence in ${p.targetLanguage} that uses this verb in a common, unambiguous way (present or perfect tense, whichever a native speaker would actually say). Keep it short — a single clause, roughly 4-8 words — so it is realistic to reconstruct from a translation alone. Then translate that exact sentence into ${p.nativeLanguage}, naturally rather than word-for-word.

Return ONLY valid JSON, no markdown:
{ "example": "the ${p.targetLanguage} sentence", "exampleTranslation": "its ${p.nativeLanguage} translation" }`;
}

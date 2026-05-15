interface AnalysisPromptParams {
  word: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
  skipWord?: boolean;
  skipSentence?: boolean;
}

export function buildAnalysisPrompt(p: AnalysisPromptParams): string {
  const jsonStructure: any = {};
  
  if (!p.skipWord) {
    jsonStructure.word = {
      text: "the exact word form as it appears",
      lemma: "dictionary/base form",
      partOfSpeech: `noun/verb/adjective/adverb/etc in ${p.nativeLanguage}`,
      gender: "grammatical gender if applicable (der/die/das for German, etc), or empty string",
      translation: `primary translation in ${p.nativeLanguage}`,
      explanation: `brief contextual explanation in ${p.nativeLanguage}, 1-2 sentences`
    };
    jsonStructure.examples = [
      { text: `example phrase 1 in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      { text: `example phrase 2 in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` }
    ];
  }
  
  jsonStructure.phrase = {
    text: "the meaningful phrase or collocation this word belongs to (2-6 words typically)",
    translation: `translation of the phrase in ${p.nativeLanguage}`,
    type: "idiom OR collocation OR compound OR noun_phrase OR verb_phrase",
    explanation: `why this phrase is interesting or notable, in ${p.nativeLanguage}`
  };
  
  if (!p.skipSentence) {
    jsonStructure.sentence = {
      text: p.sentence,
      translation: `full sentence translation in ${p.nativeLanguage}`,
      grammarNote: `key grammar point illustrated by this sentence, in ${p.nativeLanguage}`,
      structure: `brief description of sentence structure in ${p.nativeLanguage}`
    };
  }

  return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

The student tapped the word: "${p.word}"

Context:
Previous sentence: "${p.sentenceBefore}"
Current sentence: "${p.sentence}"
Next sentence: "${p.sentenceAfter}"

Analyze the word in context and return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
${JSON.stringify(jsonStructure, null, 2)}`;
}

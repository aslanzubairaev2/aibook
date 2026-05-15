interface SentencePromptParams {
  word: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
}

export function buildSentencePrompt(p: SentencePromptParams): string {
  return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

The student is reading a text and encountered the word "${p.word}".

Context:
Previous sentence: "${p.sentenceBefore}"
Current sentence: "${p.sentence}"
Next sentence: "${p.sentenceAfter}"

Analyze ONLY the current sentence and return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "sentence": {
    "text": "${p.sentence}",
    "translation": "full sentence translation in ${p.nativeLanguage}",
    "grammarNote": "key grammar point illustrated by this sentence, in ${p.nativeLanguage}",
    "structure": "brief description of sentence structure in ${p.nativeLanguage}"
  }
}`;
}

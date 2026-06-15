import type { AiMode } from "@/lib/types";

interface AnalysisPromptParams {
  mode: AiMode;
  word: string;
  text?: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
}

export function buildAnalysisPrompt(p: AnalysisPromptParams): string {
  const selectedText =
    p.mode === "word" ? p.word : (p.text || (p.mode === "phrase" ? p.word : p.sentence)).trim();
  const wordShape = {
    word: {
      text: p.word,
      lemma: "dictionary/base form or infinitive",
      partOfSpeech: `part of speech in ${p.nativeLanguage}`,
      posTag: "one of: verb | noun | adjective | adverb | pronoun | numeral | other",
      gender: "grammatical gender/article if applicable, otherwise empty string",
      translation: `short primary translation in ${p.nativeLanguage}`,
      explanation: `short dictionary-style note in ${p.nativeLanguage}`,
      nounDetails: {
        article: "article if it is a noun, otherwise empty string",
        plural: "plural form if it is a noun, otherwise empty string",
      },
      verbDetails: {
        infinitive: "infinitive if it is a verb, otherwise empty string",
        tense: "tense/person context if obvious, otherwise empty string",
        person: "person/number if obvious, otherwise empty string",
      },
    },
    examples: [
      { text: `short example in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      { text: `short example in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      { text: `short example in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      { text: `short example in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      { text: `short example in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
    ],
  };
  const phraseShape = {
    phrase: {
      text: selectedText,
      translation: `natural translation of the exact phrase in ${p.nativeLanguage}`,
      type: "phrase",
    },
  };
  const sentenceShape = {
    sentence: {
      text: selectedText,
      translation: `natural translation of the exact sentence in ${p.nativeLanguage}`,
    },
  };

  if (p.mode === "word") {
    return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

Analyze this single word as a clean dictionary entry, not as a sentence translation.

Word: "${p.word}"
Current sentence for form detection only: "${p.sentence}"

Return ONLY a valid JSON object with this exact structure:
${JSON.stringify(wordShape, null, 2)}

Do not include phrase translation, sentence translation, or markdown.`;
  }

  if (p.mode === "phrase") {
    return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

Translate only this exact phrase. Do not translate the full sentence.

Phrase: "${selectedText}"
Current sentence for context only: "${p.sentence}"

Return ONLY a valid JSON object with this exact structure:
${JSON.stringify(phraseShape, null, 2)}

Do not include word analysis, examples, sentence translation, markdown, or extra explanation.`;
  }

  return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

Translate only the current sentence.

Previous sentence: "${p.sentenceBefore}"
Current sentence: "${selectedText}"
Next sentence: "${p.sentenceAfter}"

Return ONLY a valid JSON object with this exact structure:
${JSON.stringify(sentenceShape, null, 2)}

Do not include word analysis, phrase translation, examples, markdown, or extra explanation.`;
}

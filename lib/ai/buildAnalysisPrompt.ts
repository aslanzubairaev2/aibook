import type { AiMode } from "@/lib/types";

interface AnalysisPromptParams {
  mode: AiMode;
  /**
   * Which way round the lookup runs.
   *
   * The default is the reader's: a word in the language being learned,
   * explained in the learner's own. "native-to-target" is the flashcard
   * trainer's reverse prompt — the card shows Russian, the learner does not
   * know one word of the phrase, and what they need is not a translation *of*
   * it but the German for it, with the article and the forms that come with it.
   */
  direction?: "target-to-native" | "native-to-target";
  word: string;
  text?: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
}

export function buildAnalysisPrompt(p: AnalysisPromptParams): string {
  if (p.direction === "native-to-target") return buildReverseWordPrompt(p);

  const selectedText =
    p.mode === "word" ? p.word : (p.text || (p.mode === "phrase" ? p.word : p.sentence)).trim();
  const wordShape = {
    word: {
      text: p.word,
      lemma: "dictionary/base form or infinitive",
      partOfSpeech: `part of speech in ${p.nativeLanguage}`,
      posTag: "one of: verb | noun | adjective | adverb | pronoun | numeral | other",
      gender: "grammatical gender/article if applicable, otherwise empty string",
      cefr: "CEFR level of this word itself — A1, A2, B1, B2, C1 or C2, judged by how common the word is",
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

/**
 * "Как это будет на изучаемом языке" — the reverse of a dictionary entry.
 *
 * Asked from the trainer's reverse prompt, where the card is in the learner's
 * own language and one word of it is the thing they cannot produce. The answer
 * is therefore a list of ways to say it, not a definition: the usual one first,
 * each with the grammar you cannot use the word without (an article, a plural,
 * a verb's principal parts) and a note on when it is the right choice.
 */
function buildReverseWordPrompt(p: AnalysisPromptParams): string {
  const shape = {
    reverse: {
      native: p.word,
      entries: [
        {
          text: `the word or phrase in ${p.targetLanguage}`,
          article: `article, if the language has one for this word — otherwise empty string`,
          partOfSpeech: `part of speech, in ${p.nativeLanguage}`,
          posTag: "one of: verb | noun | adjective | adverb | pronoun | numeral | other",
          plural: "plural form for a noun, otherwise empty string",
          forms: `other key forms, if any — e.g. a verb's principal parts, joined by " · "; otherwise empty string`,
          note: `when this option is the right one, in ${p.nativeLanguage} — one short line, empty string if there is nothing to distinguish`,
        },
      ],
      examples: [
        { text: `short example sentence in ${p.targetLanguage} using the first option`, translation: `translation in ${p.nativeLanguage}` },
        { text: `short example sentence in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
        { text: `short example sentence in ${p.targetLanguage}`, translation: `translation in ${p.nativeLanguage}` },
      ],
    },
  };

  return `You are an expert language teacher. The student's native language is "${p.nativeLanguage}" and they are studying "${p.targetLanguage}".

The student is looking at a sentence in their OWN language and wants to know how to say one word of it in ${p.targetLanguage}.

Word in ${p.nativeLanguage}: "${p.word}"
The ${p.nativeLanguage} sentence it appears in, for choosing the right sense only: "${p.sentence}"

Give the ways to say it in ${p.targetLanguage}, most usual first, at most 4.
- Pick the sense the sentence actually uses; do not list senses that do not fit it.
- Give every word the grammar it cannot be used without: the article and plural for a noun, the principal parts for an irregular verb.
- Add a distinguishing note only where two options are genuinely used differently.

Return ONLY a valid JSON object with this exact structure:
${JSON.stringify(shape, null, 2)}

No markdown, no text outside the JSON object.`;
}

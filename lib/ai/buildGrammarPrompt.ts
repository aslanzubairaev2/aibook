import type { GrammarTable, PosTag } from "@/lib/types";

export interface GrammarPromptParams {
  word: string;
  lemma?: string;
  posTag?: PosTag;
  targetLanguage: string;
  nativeLanguage: string;
  detail: "brief" | "full";
  contextSentence?: string;
}

// Example skeleton so the model returns exactly the shape `GrammarTable` expects.
const shape = {
  word: "the word as analyzed",
  lemma: "dictionary/base form",
  language: "target language code",
  partOfSpeech: "verb | noun | adjective | adverb | pronoun | numeral | other",
  kind: "conjugation | declension | comparison | forms",
  detail: "brief | full",
  gender: "for a noun only: m | f | n | pl — otherwise omit this field",
  sections: [
    {
      title: "section heading in the native language",
      caption: "optional short helper text in the native language, otherwise omit",
      cells: [
        { label: "native-language label", pronoun: "target-language marker or empty string", form: "inflected form in the TARGET language" },
      ],
    },
  ],
  matrix: "FILL ONLY for a VERB on the FULL view (otherwise omit). 4×3 Petrov grid — see the VERB rules below for its exact shape.",
  languageWarning: "OMIT this field unless the word clearly belongs to another language",
};

export function buildGrammarPrompt(p: GrammarPromptParams): string {
  const baseHint = p.lemma && p.lemma.toLowerCase() !== p.word.toLowerCase()
    ? `Dictionary/base form hint: "${p.lemma}"`
    : "";
  const posHint = p.posTag && p.posTag !== "other"
    ? `It is a ${p.posTag}.`
    : "First determine its part of speech.";
  const ctxHint = p.contextSentence
    ? `Context sentence (for sense disambiguation only, do NOT translate it): "${p.contextSentence}"`
    : "";

  const sizing = p.detail === "full"
    ? `Build a COMPLETE reference table — cover every main tense/case the language actually has.`
    : `Build a COMPACT table — only the single most useful paradigm.`;

  return `You are an expert ${p.targetLanguage} grammar engine. The student's native language is "${p.nativeLanguage}".

Target word (as it appeared in text): "${p.word}"
${baseHint}
${ctxHint}
Treat this strictly as a "${p.targetLanguage}" word. ${posHint}

${sizing}

Rules:
- Every "form" value MUST be written in ${p.targetLanguage}.
- Every "title", "caption", "label" and "note" MUST be written in ${p.nativeLanguage}.
- "pronoun" holds the ${p.targetLanguage} subject pronoun, article, or case marker that goes next to the form (e.g. "ich", "der/die/das", "den"). Use an empty string when there is none.
- Pick "kind" from the part of speech: verb → "conjugation", noun → "declension", adjective → "comparison", anything else → "forms".

VERB:
- brief: use "sections" — ONE section, the present tense, affirmative. "label" = the FULL native translation of the phrase (e.g. "я играю"), "pronoun" = target pronoun (e.g. "ich"), "form" = the conjugated verb (without the pronoun).
  Include all 6 core persons (1sg, 2sg, 3sg, 1pl, 2pl, 3pl) UNLESS the verb is genuinely impersonal or usage-restricted in ${p.targetLanguage} — a weather verb ("regnen", "schneien"), or one that only ever takes "es"/"it"/a 3rd-person subject in real usage ("dauern" = "to take [time]", never *"ich dauere"). For such a verb return ONLY the person(s) it is actually used with (often just "es"), not all 6 filled in with grammatically-constructible-but-never-said forms. Most verbs are NOT like this — only skip persons when a native speaker would find them genuinely wrong or absurd to hear, not merely uncommon.
- full: OMIT "sections" and instead fill the "matrix" object. "rowLabels" and "colLabels" set the headers; "cells" is a 4×3 grid.
  EXACT order — rows top→bottom = PRÄTERITUM (written past), PERFEKT (spoken past), PRESENT, FUTURE; columns left→right = negation, affirmation, question.
  "cells" MUST be a JSON array of exactly 4 elements (one per row, in that order). Each row element MUST be a JSON array of exactly 3 elements (one per column: negation, affirmation, question). Each column element MUST be a JSON array of the 6 core persons (1sg, 2sg, 3sg, 1pl, 2pl, 3pl). Each person is an object { "form": ..., "native": ... }.
  "form" = the COMPLETE natural ${p.targetLanguage} phrase for that person+tense+polarity, correct word order (questions begin with the verb and end with "?"; negation uses the proper negator). "native" = the FULL ${p.nativeLanguage} translation of that whole phrase (e.g. "я играю", "я не играю", "играю ли я?") — NOT just the pronoun.
  Row 1, PRÄTERITUM: the simple past used in writing/narration — for German the classic Präteritum ("ich spielte", question "spielte ich?", negation "ich spielte nicht"); for French the imparfait. For a language with no such written-past form, repeat the same tense as row 2. Label it to say so, e.g. "Прошедшее время (Präteritum)".
  Row 2, PERFEKT: the tense a native speaker actually uses in everyday SPEECH for a COMPLETED action — NOT the literary/written tense. For German that means the Perfekt (haben/sein + Partizip II with the participle at the END: "ich habe gespielt", question "habe ich gespielt?", negation "ich habe nicht gespielt"); use the Präteritum form here too only for sein/haben/modal verbs (war, hatte, musste), since for those the spoken form already is the Präteritum. For French use the passé composé. Translate this row as a completed action in ${p.nativeLanguage} (Russian: perfective "я сыграл", NOT "я играл"). Label it accordingly, e.g. "Прошедшее время (Perfekt)".
  Concrete shape (illustrative, for "spielen"):
    "matrix": {
      "rowLabels": ["Прошедшее время (Präteritum)", "Прошедшее время (Perfekt)", "Настоящее время", "Будущее время"],
      "colLabels": ["Отрицание", "Утверждение", "Вопрос"],
      "cells": [
        [ [ {"form":"ich spielte nicht","native":"я не играл"}, "...5 more persons" ], [ {"form":"ich spielte","native":"я играл"}, "..." ], [ {"form":"spielte ich?","native":"играл ли я?"}, "..." ] ],
        [ [ {"form":"ich habe nicht gespielt","native":"я не сыграл"}, "...5 more persons" ], [ {"form":"ich habe gespielt","native":"я сыграл"}, "..." ], [ {"form":"habe ich gespielt?","native":"сыграл ли я?"}, "..." ] ],
        [ "...present: negation, affirmation, question..." ],
        [ "...future: negation, affirmation, question..." ]
      ]
    }
  Choose the single most standard written-past, spoken-past, and future tense for the language. Never nest differently or use objects where an array is required.

NOUN:
- set the top-level "gender" field (m/f/n, or pl for plural-only nouns).
- "label" must be a SHORT case + number tag, e.g. "Им. ед.ч.", "Род. мн.ч." (abbreviated, never a full sentence). "pronoun" = the article for that cell. "form" = the noun form.
- brief: ONE section with the article + singular and plural (label them "ед. ч." / "мн. ч.").
- full: if the language inflects for case (e.g. German, Russian), give one section "Единственное число" and one "Множественное число", each listing the cases as rows with the correct article per cell; otherwise just singular/plural and any common derived forms.

ADJECTIVE:
- brief: positive, comparative, superlative.
- full: add declension/agreement forms if the language inflects adjectives.

OTHER parts of speech: provide whatever inflected or related forms exist; if the word is invariable, return one section noting that in ${p.nativeLanguage}.

If the word is clearly NOT a valid or common "${p.targetLanguage}" word and instead looks like it belongs to a different language, set "languageWarning" to a short note in ${p.nativeLanguage} naming the language it likely belongs to. Otherwise omit the field entirely.

Return ONLY a valid JSON object with exactly this structure (no markdown):
${JSON.stringify(shape, null, 2)}`;
}

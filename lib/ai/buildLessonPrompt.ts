// Prompt for the "Мои уроки" generator.
//
// This is the half of the catalogue that a public corpus cannot provide: a text
// at the reader's own level, on a topic they picked, that reuses the exact words
// sitting in their flashcard deck waiting for review. Everything downstream —
// tap-a-word analysis, TTS, grammar tables, live chat — already works on any
// paragraph list, so the generator only has to produce good paragraphs.

import type { CefrLevel } from "@/lib/types";

export type LessonRequest = {
  level: CefrLevel;
  topic: string;
  targetLanguage: string;
  nativeLanguage: string;
  /** Words from the learner's deck to weave in, if any. */
  reviewWords: string[];
  length: "short" | "medium" | "long";
};

export type GeneratedLesson = {
  title: string;
  description: string;
  paragraphs: string[];
  vocabulary: { term: string; translation: string }[];
  questions: string[];
};

const LENGTH_HINTS: Record<LessonRequest["length"], string> = {
  short: "4-5 paragraphs of 2-3 sentences each",
  medium: "6-8 paragraphs of 3-4 sentences each",
  long: "10-12 paragraphs of 4-5 sentences each",
};

const LEVEL_HINTS: Record<CefrLevel, string> = {
  A1: "present tense only, ~500 most common words, very short main clauses, no subordinate clauses",
  A2: "present and perfect tense, common everyday vocabulary, simple subordinate clauses with weil/dass",
  B1: "past and future tenses, connectors, moderate abstraction, some idiomatic phrasing",
  B2: "passive voice, subjunctive II, abstract argument, varied sentence structure",
  C1: "nuanced register, complex syntax, figurative and idiomatic language, specialised vocabulary",
  C2: "near-native complexity, subtle connotation, sophisticated rhetoric",
};

export function buildLessonPrompt(req: LessonRequest): string {
  const words = req.reviewWords.slice(0, 12);

  return `You write graded reading texts for language learners.

Learner profile:
- Target language: ${req.targetLanguage}
- Native language (for translations and explanations): ${req.nativeLanguage}
- CEFR level: ${req.level} — ${LEVEL_HINTS[req.level] ?? ""}
- Topic requested: ${req.topic}

Write a coherent, engaging text in ${req.targetLanguage} on that topic, ${LENGTH_HINTS[req.length]}.
The text must read like real writing on the topic, not like a grammar drill.
Stay strictly within ${req.level} vocabulary and grammar.

${words.length > 0
    ? `Weave these words the learner is currently revising into the text naturally, each at least once, in a context that makes its meaning inferable:
${words.map((w) => `- ${w}`).join("\n")}
Do not force all of them into one paragraph and do not mark them up in any way.`
    : "The learner has no revision words yet — choose vocabulary typical for the level and topic."}

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in ${req.targetLanguage}",
  "description": "one sentence in ${req.nativeLanguage} describing what the text is about",
  "paragraphs": ["paragraph 1", "paragraph 2", "..."],
  "vocabulary": [{ "term": "word or phrase in ${req.targetLanguage}", "translation": "translation in ${req.nativeLanguage}" }],
  "questions": ["comprehension question in ${req.targetLanguage}", "..."]
}

Rules:
- "paragraphs" contains ONLY the text itself in ${req.targetLanguage} — no headings, no numbering, no translations, no markdown. The app renders each entry as one paragraph.
- "vocabulary": 8-12 entries, the words most likely to be new at ${req.level}, including any revision words used.
- "questions": 3 short comprehension questions in ${req.targetLanguage}.
- No markdown anywhere. No text outside the JSON object.`;
}

/** Narrow the model's raw JSON to a lesson, or null when it is unusable. */
export function parseGeneratedLesson(raw: unknown): GeneratedLesson | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const paragraphs = Array.isArray(obj.paragraphs)
    ? obj.paragraphs.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
    : [];
  if (paragraphs.length < 2) return null;

  const vocabulary = Array.isArray(obj.vocabulary)
    ? obj.vocabulary
        .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
        .map((v) => ({ term: String(v.term ?? "").trim(), translation: String(v.translation ?? "").trim() }))
        .filter((v) => v.term.length > 0)
    : [];

  const questions = Array.isArray(obj.questions)
    ? obj.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim())
    : [];

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Урок",
    description: typeof obj.description === "string" ? obj.description.trim() : "",
    paragraphs,
    vocabulary,
    questions,
  };
}

/**
 * Flatten a lesson into the paragraph list the reader consumes.
 *
 * Vocabulary and questions become trailing sections. Their headings are short
 * lines ending in a colon, which is what ReaderView.isLessonHeading picks up to
 * style them as headings — same convention the old seeded lessons used.
 */
export function lessonToParagraphs(lesson: GeneratedLesson, nativeLabelWords: string, nativeLabelQuestions: string): string[] {
  const paragraphs = [...lesson.paragraphs];

  if (lesson.vocabulary.length > 0) {
    paragraphs.push(`${nativeLabelWords}:`);
    for (const v of lesson.vocabulary) {
      paragraphs.push(v.translation ? `${v.term} — ${v.translation}` : v.term);
    }
  }

  if (lesson.questions.length > 0) {
    paragraphs.push(`${nativeLabelQuestions}:`);
    for (const q of lesson.questions) paragraphs.push(q);
  }

  return paragraphs;
}

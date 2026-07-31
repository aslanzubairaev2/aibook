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
  /**
   * Free-text facts from the learner ("my friend runs a flower shop, we live
   * together"). These outrank the revision words: a word that would contradict
   * them gets dropped rather than forced in.
   */
  context?: string;
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
  const context = (req.context ?? "").trim();

  return `You write graded reading texts for language learners.

Learner profile:
- Target language: ${req.targetLanguage}
- Native language (for translations and explanations): ${req.nativeLanguage}
- CEFR level: ${req.level} — ${LEVEL_HINTS[req.level] ?? ""}
- Topic requested: ${req.topic}

Write a coherent, engaging text in ${req.targetLanguage} on that topic, ${LENGTH_HINTS[req.length]}.
The text must read like real writing on the topic, not like a grammar drill.
Stay strictly within ${req.level} vocabulary and grammar.
${context ? `
Facts the learner gave about the situation — treat these as true and build the text around them:
${context}
` : ""}
${words.length > 0
    ? `The learner is currently revising the words below. Use the ones that fit the topic naturally, in a context that makes the meaning inferable:
${words.map((w) => `- ${w}`).join("\n")}

How to handle them — this matters more than covering all of them:
- Prefer a believable text over a complete word list. SKIP any word that would only fit by inventing an odd detail, a pointless aside, or a character whose job exists solely to justify the word.
- Never contradict the facts above to make a word fit.
- Spread the ones you do use across the text; do not cluster them in one paragraph.
- Do not mark them up, bold them, or call attention to them in any way.
- It is a good result to use only half of them well.`
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

export type LessonRefineRequest = {
  level: CefrLevel;
  targetLanguage: string;
  nativeLanguage: string;
  /** The lesson as it stands, one entry per paragraph. */
  currentParagraphs: string[];
  /** What the learner wants changed, in their own words. */
  instructions: string;
};

/**
 * Rewrite an existing lesson from the learner's notes.
 *
 * Deliberately a rewrite of the given text rather than a fresh generation:
 * the learner is reacting to *this* text, so everything they did not object to
 * has to survive. That is also why the current text is passed in full instead
 * of just the topic.
 */
export function buildLessonRefinePrompt(req: LessonRefineRequest): string {
  return `You revise graded reading texts for language learners.

Below is a text at CEFR level ${req.level} in ${req.targetLanguage}, and the
learner's notes on what they want changed. The notes may be written in
${req.nativeLanguage}.

Current text (one paragraph per line):
${req.currentParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Learner's notes:
${req.instructions}

Apply the notes and return the full revised lesson.

Rules:
- Change what the notes ask for and what logically follows from it. Leave the rest as close to the original as you can — this is an edit, not a new text on the same topic.
- If a note contradicts a detail elsewhere in the text, fix that detail too so the result stays consistent.
- Keep the same CEFR level (${req.level} — ${LEVEL_HINTS[req.level] ?? ""}), roughly the same length, and the same overall structure.
- Keep the ${req.targetLanguage} natural; never carry the learner's notes into the text verbatim.
- Rebuild the vocabulary list to match the revised text, dropping entries for words that are gone.

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in ${req.targetLanguage}",
  "description": "one sentence in ${req.nativeLanguage} describing what the text is about",
  "paragraphs": ["paragraph 1", "paragraph 2", "..."],
  "vocabulary": [{ "term": "word or phrase in ${req.targetLanguage}", "translation": "translation in ${req.nativeLanguage}" }],
  "questions": ["comprehension question in ${req.targetLanguage}", "..."]
}

"paragraphs" contains ONLY the text itself in ${req.targetLanguage} — no headings, no numbering, no translations, no markdown. No text outside the JSON object.`;
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

export const VOCAB_HEADING = "Wortschatz";
export const QUESTIONS_HEADING = "Fragen";

/**
 * Flatten a lesson into the paragraph list the reader consumes.
 *
 * Vocabulary and questions become trailing sections. Their headings are short
 * lines ending in a colon, which is what ReaderView.isLessonHeading picks up to
 * style them as headings — same convention the old seeded lessons used.
 */
export function lessonToParagraphs(lesson: GeneratedLesson): string[] {
  const paragraphs = [...lesson.paragraphs];

  if (lesson.vocabulary.length > 0) {
    paragraphs.push(`${VOCAB_HEADING}:`);
    for (const v of lesson.vocabulary) {
      paragraphs.push(v.translation ? `${v.term} — ${v.translation}` : v.term);
    }
  }

  if (lesson.questions.length > 0) {
    paragraphs.push(`${QUESTIONS_HEADING}:`);
    for (const q of lesson.questions) paragraphs.push(q);
  }

  return paragraphs;
}

/**
 * Recover just the reading text from a stored lesson, dropping the vocabulary
 * and question sections appended by lessonToParagraphs.
 *
 * Revision works on the prose alone — feeding the word list back to the model
 * as if it were part of the text produces lessons that talk about their own
 * glossary. `bodyCount` is recorded in metadata at generation time; the heading
 * scan is the fallback for lessons generated before that was stored.
 */
export function extractLessonBody(paragraphs: string[], bodyCount?: number): string[] {
  if (typeof bodyCount === "number" && bodyCount > 0 && bodyCount <= paragraphs.length) {
    return paragraphs.slice(0, bodyCount);
  }
  const headingIndex = paragraphs.findIndex(
    (p) => p.trim() === `${VOCAB_HEADING}:` || p.trim() === `${QUESTIONS_HEADING}:`
  );
  return headingIndex > 0 ? paragraphs.slice(0, headingIndex) : paragraphs;
}

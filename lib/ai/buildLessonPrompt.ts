// Prompt for the "Мои уроки" generator.
//
// This is the half of the catalogue that a public corpus cannot provide: a text
// at the reader's own level, on a topic they picked, that reuses the exact words
// sitting in their flashcard deck waiting for review. Everything downstream —
// tap-a-word analysis, TTS, grammar tables, live chat — already works on any
// paragraph list, so the generator only has to produce good paragraphs.

import type { CefrLevel } from "@/lib/types";

/**
 * The two things «Мои уроки» can hold, and they are not the same thing.
 *
 * - "text" is something to read. Prose, and nothing else in the way of it —
 *   no glossary between the learner and the page, just a few questions at the
 *   end to check that it landed.
 * - "lesson" is something to work through. It teaches one point: what it is,
 *   how it is built, worked examples, the point in use, and exercises with the
 *   answers at the bottom.
 *
 * They used to be one generator, which is why «Сделать урок» produced a text
 * with a word list stapled to it and nothing to actually do.
 */
export type LessonKind = "text" | "lesson";

export type LessonRequest = {
  kind?: LessonKind;
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
  /**
   * The pack this was built from, when it was: its name and the brief it was
   * collected to. A pack of accusative masculine nouns is a specification for
   * the text, not just a bag of words to sprinkle through it.
   */
  packTitle?: string;
  packBrief?: string;
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
  if (req.kind === "lesson") return buildCourseLessonPrompt(req);

  const words = req.reviewWords.slice(0, 12);
  const context = (req.context ?? "").trim();
  const pack = packLines(req);

  return `You write graded reading texts for language learners.

Learner profile:
- Target language: ${req.targetLanguage}
- Native language (for translations and explanations): ${req.nativeLanguage}
- CEFR level: ${req.level} — ${LEVEL_HINTS[req.level] ?? ""}
- Topic requested: ${req.topic}
${pack}
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
- "vocabulary": leave this an empty array. This is a text to read, and a glossary printed under it is read instead of the text; the app looks a word up when the reader taps it.
- "questions": 3-5 short comprehension questions in ${req.targetLanguage}, answerable from the text, to check it was understood.
- No markdown anywhere. No text outside the JSON object.`;
}

/** The pack a text or lesson was built from, and the brief behind it. */
function packLines(req: LessonRequest): string {
  const title = (req.packTitle ?? "").trim();
  const brief = (req.packBrief ?? "").trim();
  if (!title && !brief) return "";
  return `
This was built from the learner's own pack${title ? ` «${title}»` : ""}.${brief ? `
The pack was collected to this brief — treat it as a specification for the language you use, not just as a source of words:
${brief}` : ""}
`;
}

const LESSON_LENGTH_HINTS: Record<LessonRequest["length"], string> = {
  short: "one focused pass: a short explanation, 4-6 examples, a 6-line dialogue or paragraph, 5 exercise items",
  medium: "a full sitting: explanation with a small table, 8-10 examples, a dialogue or short text of 8-12 lines, 8-10 exercise items",
  long: "a thorough lesson: explanation with the exceptions, 12-15 examples, two connected texts or dialogues, 12-15 exercise items",
};

/**
 * A lesson: something to work through, not something to read.
 *
 * The structure is carried in the paragraph list, because that is what the app
 * stores and what its reader renders: a short line ending in a colon is styled
 * as a heading, so the sections below survive the round trip without a schema
 * of their own. Everything explanatory is in the learner's own language and
 * everything being learned is in the target one — a lesson that explains the
 * accusative in the accusative teaches nobody.
 */
function buildCourseLessonPrompt(req: LessonRequest): string {
  const words = req.reviewWords.slice(0, 20);
  const context = (req.context ?? "").trim();
  const pack = packLines(req);

  return `You are an experienced language teacher writing one self-contained lesson for a learner to work through on their own.

Learner profile:
- Target language: ${req.targetLanguage}
- Native language (all explanations and instructions are in this language): ${req.nativeLanguage}
- CEFR level: ${req.level} — ${LEVEL_HINTS[req.level] ?? ""}
- What the lesson is about: ${req.topic}
${pack}
Size: ${LESSON_LENGTH_HINTS[req.length]}.
${context ? `
What the learner told you about what they want from it — this outranks everything below:
${context}
` : ""}
${words.length > 0
    ? `Build the lesson on the learner's own material below. These are the words and phrases they are learning right now; the examples, the text and the exercises should be made of them wherever they fit naturally:
${words.map((w) => `- ${w}`).join("\n")}
Skip any that would force an absurd sentence — a believable lesson beats a complete list.`
    : "Choose vocabulary typical for the level and the topic."}

Teach ONE thing. Decide from the topic what the single point of this lesson is (a case, a tense, a word-formation pattern, a set of expressions for one situation), and let everything in the lesson serve it.

Return the lesson as an ordered list of paragraphs with these sections, each introduced by a short heading line ending in a colon, written in ${req.nativeLanguage}:
1. «Что учим:» — two or three sentences in ${req.nativeLanguage} saying what this lesson gives the learner and how they will know they have it.
2. «Как это устроено:» — the explanation, in ${req.nativeLanguage}. Say the rule plainly, then show the pattern; where there is a paradigm (endings, forms, articles), write it out one line per row as «form — meaning». Name the one mistake a ${req.nativeLanguage} speaker reliably makes here.
3. «Примеры:» — one example per paragraph, each as «sentence in ${req.targetLanguage} — translation in ${req.nativeLanguage}». Ordinary sentences a person would say, ordered from the plainest to the least obvious.
4. «Живой текст:» — a short dialogue or passage in ${req.targetLanguage} using the point repeatedly and naturally, one line or one paragraph per entry. No translation here: this is the part they read.
5. «Слушаем:» — 3-4 sentences in ${req.targetLanguage}, on their own lines, meant to be played and repeated aloud. Pick sentences whose sound is the difficulty (an ending that disappears in speech, a stress, a linking).
6. «Упражнение:» — numbered items, one per paragraph, each a task the learner writes or says the answer to: a gap to fill, a sentence to turn round, a phrase to translate from ${req.nativeLanguage}. Say what to do in ${req.nativeLanguage}; the material is in ${req.targetLanguage}.
7. «Ответы:» — the answers to the exercise, one per paragraph, numbered to match. This is the last section.

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in ${req.nativeLanguage} naming what is taught",
  "description": "one sentence in ${req.nativeLanguage} describing what this lesson teaches and to whom",
  "paragraphs": ["heading line", "paragraph", "..."],
  "vocabulary": [{ "term": "word or phrase in ${req.targetLanguage}", "translation": "translation in ${req.nativeLanguage}" }],
  "questions": ["check question in ${req.nativeLanguage} or ${req.targetLanguage}", "..."]
}

Rules:
- Every entry of "paragraphs" is one paragraph or one line of the lesson, in the order above. Headings are their own entries and end with a colon. No numbering of paragraphs beyond the exercise's own item numbers, no markdown, no bold.
- "vocabulary": 8-15 entries — the words and forms this lesson actually teaches, so they can be turned into cards.
- "questions": 3-4 questions the learner can answer to check they have the point, not comprehension questions about the text.
- No text outside the JSON object.`;
}

export type LessonRefineRequest = {
  kind?: LessonKind;
  level: CefrLevel;
  targetLanguage: string;
  nativeLanguage: string;
  /** The lesson as it stands, one entry per paragraph. */
  currentParagraphs: string[];
  /** What the learner wants changed, in their own words. */
  instructions: string;
  /**
   * A new size, when the learner asked for one.
   *
   * "Сделай покороче" is the commonest revision there is and the clumsiest to
   * write out, so it is a control rather than a sentence to type. Absent means
   * the length stays as it is.
   */
  length?: LessonRequest["length"];
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
- Keep the same CEFR level (${req.level} — ${LEVEL_HINTS[req.level] ?? ""}) and the same overall structure.
${req.length
    ? `- Resize it to ${LENGTH_HINTS[req.length]}. Cut or expand evenly rather than dropping or padding the end, and keep everything the notes ask to keep.`
    : "- Keep it roughly the same length."}
- Keep the ${req.targetLanguage} natural; never carry the learner's notes into the text verbatim.
${req.kind === "lesson"
    ? "- This is a lesson, not a story: keep its sections and their heading lines, keep the exercise numbered, and keep the answers matching it."
    : "- Rebuild the vocabulary list to match the revised text, dropping entries for words that are gone."}

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
  // One paragraph is a legitimate result — a sign, a label, a short notice.
  // Demanding two turned those photos into "не удалось разобрать ответ".
  if (paragraphs.length === 0) return null;

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
 *
 * `kind` decides whether the glossary is appended at all: see below.
 */
export function lessonToParagraphs(lesson: GeneratedLesson, kind: LessonKind = "lesson"): string[] {
  const paragraphs = [...lesson.paragraphs];

  // A text is for reading. A glossary printed under it gets read instead of
  // the text, and the app already looks a word up when the reader taps it —
  // so a text keeps only its questions.
  if (kind !== "text" && lesson.vocabulary.length > 0) {
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

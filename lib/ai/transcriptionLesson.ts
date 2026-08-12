// Building a lesson straight out of a photo's transcription, with no second
// model call.
//
// The photo flow is two steps: read the page, then rewrite it into a document.
// The second step is what fails — it is the long one, the one that has to
// reproduce a whole page inside an output budget. When it does fail, the
// transcription from step one is still sitting there, and it is most of what
// the learner wanted: the actual words on the page. Handing that over beats
// showing an error and throwing the reading away.
//
// It is a fallback, not the main path: the model step also repairs hyphenation,
// re-joins columns and adds a glossary. So this is used only when the rewrite
// could not be had at all.

import type { GeneratedLesson } from "./buildLessonPrompt";

/**
 * Split a transcription into paragraphs.
 *
 * Blank lines are the reliable separator. Failing that — a page transcribed as
 * one line per printed line — consecutive lines are joined into a paragraph and
 * a line ending in sentence punctuation closes it, which is about as well as
 * anyone can do without the layout.
 */
export function splitTranscription(text: string): string[] {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  if (!normalised) return [];

  if (/\n\s*\n/.test(normalised)) {
    return normalised
      .split(/\n\s*\n+/)
      .map((block) => block.split("\n").map((l) => l.trim()).filter(Boolean).join(" "))
      .filter(Boolean);
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of normalised.split("\n").map((l) => l.trim())) {
    if (!line) continue;
    current.push(line);
    // A heading (short, no closing punctuation) stands alone; a line closing a
    // sentence ends the paragraph.
    if (/[.!?:;»"']$/.test(line) || line.length < 40) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs.filter(Boolean);
}

/** A short title from the first line, so the lesson is recognisable in the list. */
function titleFrom(paragraphs: string[]): string {
  const first = paragraphs[0] ?? "";
  const sentence = first.split(/(?<=[.!?])\s/)[0] ?? first;
  const title = sentence.length > 60 ? `${sentence.slice(0, 57).trimEnd()}…` : sentence;
  return title || "Снимок";
}

/**
 * The transcription as a lesson: no glossary, no questions, no repairs — the
 * page as it was read.
 */
export function lessonFromTranscription(sourceText: string, kind?: string): GeneratedLesson | null {
  const paragraphs = splitTranscription(sourceText);
  if (paragraphs.length === 0) return null;

  return {
    title: titleFrom(paragraphs),
    // Says plainly what the learner is looking at, so a degraded result is
    // never passed off as the full one.
    description: kind
      ? `${kind}. Текст со снимка как есть — без разбора слов.`
      : "Текст со снимка как есть — без разбора слов.",
    paragraphs,
    vocabulary: [],
    questions: [],
  };
}

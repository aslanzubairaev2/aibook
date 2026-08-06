// Turning a photographed page, label or sign into a lesson.
//
// Two steps, deliberately separate. The image is read once (expensive, and the
// result is just text); everything after that works on text, so choosing a
// language or retrying a bad result costs nothing extra.

import type { CefrLevel } from "@/lib/types";

// ─── Step 1: read the photo ──────────────────────────────────────────────────

export type ExtractedImageText = {
  /** ISO 639-1 of the dominant language in the photo, or "" when unreadable. */
  language: string;
  /** Everything legible, in reading order. */
  text: string;
  /** What the photo appears to be — a textbook page, a label, a sign. */
  kind: string;
};

export function buildImageExtractPrompt(): string {
  return `You are reading a photograph for a language-learning app.

Transcribe the text you can see and report which language it is in.

Rules:
- Transcribe faithfully in reading order. Keep the original spelling, including accents and umlauts. Do not translate anything at this stage.
- Include every legible piece of text: headings, body, captions, labels, prices, signs.
- Skip page numbers, publisher boilerplate, barcodes and decorative fragments.
- If a word is cut off or blurred beyond recognition, drop it rather than guessing.
- "language" is the ISO 639-1 code of the language MOST of the text is in ("de", "ru", "en", …). If the photo has no readable text at all, return an empty string for both "language" and "text".

Return ONLY valid JSON with this exact shape:
{
  "language": "ISO 639-1 code",
  "kind": "short description of what this is, in Russian (e.g. 'страница учебника', 'этикетка', 'вывеска')",
  "text": "the transcribed text"
}

No markdown, no commentary, nothing outside the JSON object.`;
}

/** Narrow the model's raw JSON, or null when it is unusable. */
export function parseExtractedImageText(raw: unknown): ExtractedImageText | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  return {
    language: typeof obj.language === "string" ? obj.language.trim().toLowerCase().slice(0, 5) : "",
    text,
    kind: typeof obj.kind === "string" ? obj.kind.trim() : "",
  };
}

// ─── Step 2: build a lesson from the transcription ───────────────────────────

export type LessonFromSourceRequest = {
  sourceText: string;
  /** Language of the photographed text. */
  sourceLanguage: string;
  targetLanguage: string;
  nativeLanguage: string;
  level: CefrLevel;
  length: "short" | "medium" | "long";
};

const LENGTH_HINTS: Record<LessonFromSourceRequest["length"], string> = {
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

export function buildLessonFromSourcePrompt(req: LessonFromSourceRequest): string {
  const sameLanguage = req.sourceLanguage === req.targetLanguage;

  // Photographed text is raw: OCR noise, fragments, a level that may be nothing
  // like the learner's. Two different jobs depending on where it started.
  const job = sameLanguage
    ? `The text below was photographed and is already in ${req.targetLanguage}.

Turn it into a readable lesson:
- Keep the subject matter, the facts and the specific vocabulary of the original — that is what the learner photographed and wants to study.
- Repair transcription damage: broken words, missing punctuation, fragments run together, lines split mid-sentence.
- Rewrite it into connected prose at CEFR ${req.level} (${LEVEL_HINTS[req.level] ?? ""}). Simplify structures that sit above that level, but do NOT drop the topic vocabulary — reintroduce a hard but central word in a context that explains it.
- If the source is only fragments (a label, a sign, a word list), write a short coherent text at ${req.level} that uses them naturally in a real situation.`
    : `The text below was photographed and is in ${req.sourceLanguage}, which is not the language being learned.

Write a NEW text in ${req.targetLanguage} on the same subject:
- Do not translate sentence by sentence. Take the topic, the facts and the specifics, and write a natural text a ${req.targetLanguage} speaker would write about them.
- Keep concrete details from the source (names, numbers, places, terms) so the learner recognises the material.
- Write at CEFR ${req.level} (${LEVEL_HINTS[req.level] ?? ""}).`;

  return `You write graded reading texts for language learners.

${job}

Length: ${LENGTH_HINTS[req.length]}.

Photographed source:
"""
${req.sourceText.slice(0, 6000)}
"""

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in ${req.targetLanguage}",
  "description": "one sentence in ${req.nativeLanguage} describing what the text is about",
  "paragraphs": ["paragraph 1", "paragraph 2", "..."],
  "vocabulary": [{ "term": "word or phrase in ${req.targetLanguage}", "translation": "translation in ${req.nativeLanguage}" }],
  "questions": ["comprehension question in ${req.targetLanguage}", "..."]
}

Rules:
- "paragraphs" contains ONLY the text itself in ${req.targetLanguage} — no headings, no numbering, no translations, no markdown.
- "vocabulary": 8-12 entries, the words most likely to be new at ${req.level}, prioritising the topic vocabulary from the source.
- "questions": 3 short comprehension questions in ${req.targetLanguage}.
- No markdown anywhere. No text outside the JSON object.`;
}

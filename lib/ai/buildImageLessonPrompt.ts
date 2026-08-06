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


// ─── Step 2: turn the transcription into a readable document ─────────────────
//
// Deliberately NOT graded. These are texts the learner meets in real life — a
// rental contract, a letter from an office, a package insert, a sign — and the
// point is to work through the real thing. Simplifying it to A2 would destroy
// exactly what they photographed it for. So: no level, no length target, no
// rewriting. Faithful, and as hard as it happens to be.

export type DocumentFromSourceRequest = {
  sourceText: string;
  /** Language of the photographed text. */
  sourceLanguage: string;
  targetLanguage: string;
  nativeLanguage: string;
};

export function buildDocumentFromSourcePrompt(req: DocumentFromSourceRequest): string {
  const sameLanguage = req.sourceLanguage === req.targetLanguage;

  const job = sameLanguage
    ? `The text below was photographed and is already in ${req.targetLanguage}.

Restore it, and change nothing else:
- Repair damage from the photo: words broken across line ends, characters misread, missing punctuation, lines run together, columns interleaved.
- Keep every sentence, every clause, every number, name, date, amount and reference exactly as it stands.
- Keep the register. A contract stays a contract, an official letter stays official, a sign stays terse. Do not make it friendlier, shorter or easier.
- Do NOT simplify vocabulary or grammar. Do NOT summarise. Do NOT explain inside the text.
- If a passage is illegible, omit it rather than inventing it.`
    : `The text below was photographed and is in ${req.sourceLanguage}. The learner wants it in ${req.targetLanguage}.

Translate it accurately:
- Convey exactly what the source says — every statement, condition, number, name, date and amount. Nothing added, nothing left out, nothing softened.
- Translate meaning, not words. The result must read as natural ${req.targetLanguage}, the way it would have been written by someone drafting this document in ${req.targetLanguage}. Avoid word-for-word calques and source-language word order.
- Preserve the register and the document type: legal text stays legal, official stays official, a label stays a label. Use the established ${req.targetLanguage} terminology for the domain.
- Do NOT simplify for a learner. Do NOT shorten. The difficulty of the result should match the difficulty of the source.
- Keep proper names, addresses and identifiers in their original form unless the target language has an established equivalent.`;

  return `You prepare real-world documents for a language learner to study.

${job}

Keep the original structure: one paragraph per paragraph, headings on their own line, list items on their own lines. Do not merge or reorder them.

Photographed source:
"""
${req.sourceText.slice(0, 8000)}
"""

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in ${req.targetLanguage} naming what this document is",
  "description": "one sentence in ${req.nativeLanguage} saying what this is and what it is about",
  "paragraphs": ["paragraph 1", "paragraph 2", "..."],
  "vocabulary": [{ "term": "word or phrase in ${req.targetLanguage}", "translation": "translation in ${req.nativeLanguage}" }],
  "questions": []
}

Rules:
- "paragraphs" is the document itself in ${req.targetLanguage} and nothing else — no headings you invented, no numbering you added, no translations, no notes, no markdown.
- "vocabulary": 10-15 entries — the terms a learner is most likely to stumble on here, especially domain and legal vocabulary. Translate each as it is used in THIS text, not its most common meaning.
- "questions" must be an empty array. This is a real document, not an exercise.
- No markdown anywhere. No text outside the JSON object.`;
}

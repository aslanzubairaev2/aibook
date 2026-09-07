import { checkTypedAnswer, type AnswerVerdict } from "@/lib/srs/activeTraining";

export type FastField = { key: string; label: string; expected: string };
export type FastFieldResult = { key: string; label: string; expected: string; given: string; verdict: AnswerVerdict };

// "sie" covers 3rd-person-singular feminine, 3rd-person-plural, and the
// formal "Sie" — all three are optional filler when spoken, since every
// field's own label already carries its pronoun ("er/sie/es"), and none of
// them is ever itself the expected answer text (the fields hold verb forms).
const GERMAN_FILLER_PRONOUNS = new Set(["ich", "du", "er", "sie", "es", "wir", "ihr"]);

/** Lowercased words, punctuation stripped — the unit both recognition chunks and expected answers are compared in. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'»«„“()[\]\-–—]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Drops the pronouns a spoken conjugation may or may not include — "ich habe" and "habe" both start the same field. */
export function stripPronouns(tokens: string[]): string[] {
  return tokens.filter((t) => !GERMAN_FILLER_PRONOUNS.has(t));
}

/**
 * Matches a continuous transcript against an ordered list of fields, one at a
 * time: each field consumes as many words from the front of the remaining
 * stream as its own expected answer has, in the order the learner was asked
 * to say them ("ging gegangen" for Präteritum → Partizip II). A field whose
 * words have not arrived yet comes back null — the caller keeps listening
 * until every field has one.
 */
export function matchFastFields(transcriptTokens: string[], fields: FastField[]): (FastFieldResult | null)[] {
  let cursor = 0;
  return fields.map((field) => {
    const wordCount = Math.max(1, field.expected.trim().split(/\s+/).length);
    if (cursor + wordCount > transcriptTokens.length) return null;
    const given = transcriptTokens.slice(cursor, cursor + wordCount).join(" ");
    cursor += wordCount;
    const check = checkTypedAnswer(given, field.expected);
    return { key: field.key, label: field.label, expected: field.expected, given, verdict: check.verdict };
  });
}

export function isFullyMatched<T>(results: (T | null)[]): results is T[] {
  return results.every((r) => r !== null);
}

/** A "wrong" field fails the step; "almost" (typo, dropped article, …) still passes — same rule the typed quiz grades by. */
export function allFieldsPass(results: FastFieldResult[]): boolean {
  return results.every((r) => r.verdict !== "wrong");
}

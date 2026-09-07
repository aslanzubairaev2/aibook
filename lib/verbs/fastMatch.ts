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
 * time, in the order the learner was asked to say them. Each field defaults
 * to consuming a single word — the common case for every field except a
 * separable-verb form ("brachte mit") or an auxiliary+participle tense
 * ("habe gegangen"). Only when that single word plainly fails to match AND
 * the field's own stored answer has more than one word does it try consuming
 * two (then three, …) words instead, up to its own word count — and only
 * commits to the wider window if that actually produces a better verdict.
 *
 * This bounded, "escalate only if it helps" rule is what stops one field
 * from swallowing a neighbour's word: a field never eats more than it
 * demonstrably needs, so a separable verb's missing "mit" is graded wrong on
 * its own field instead of dragging the next field's word into this one and
 * leaving that next field stuck waiting forever. A field whose words have
 * not arrived yet comes back null — the caller keeps listening until every
 * field has one.
 */
export function matchFastFields(transcriptTokens: string[], fields: FastField[]): (FastFieldResult | null)[] {
  let cursor = 0;
  return fields.map((field) => {
    const available = transcriptTokens.length - cursor;
    if (available <= 0) return null;

    const expectedWordCount = Math.max(1, field.expected.trim().split(/\s+/).length);
    let window = 1;
    let check = checkTypedAnswer(transcriptTokens.slice(cursor, cursor + 1).join(" "), field.expected);

    if (check.verdict === "wrong" && expectedWordCount > 1) {
      const maxTry = Math.min(expectedWordCount, available);
      for (let w = 2; w <= maxTry; w++) {
        const candidate = transcriptTokens.slice(cursor, cursor + w).join(" ");
        const candidateCheck = checkTypedAnswer(candidate, field.expected);
        if (candidateCheck.verdict !== "wrong") { window = w; check = candidateCheck; break; }
      }
    }

    const given = transcriptTokens.slice(cursor, cursor + window).join(" ");
    cursor += window;
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

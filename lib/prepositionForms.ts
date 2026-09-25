// Shared logic for the preposition half of "Предлоги и прилагательные": which
// case a German preposition governs. Unlike noun gender this is a small,
// closed, well-documented table — not lexical data that needs an AI call per
// word, so it lives here as a plain lookup rather than a stored column.

import { normalizePos } from "@/lib/verbForms";

export type PrepositionCase = "akkusativ" | "dativ" | "genitiv" | "wechsel";

export const PREPOSITION_CASE_ORDER: PrepositionCase[] = ["akkusativ", "dativ", "genitiv", "wechsel"];

export const CASE_LABEL: Record<PrepositionCase, string> = {
  akkusativ: "Akkusativ",
  dativ: "Dativ",
  genitiv: "Genitiv",
  wechsel: "Wechsel (оба)",
};

/**
 * Whether an entry is a preposition — trusting the stored part-of-speech.
 * Unlike nouns/verbs there is no reliable fallback for a blank field: nothing
 * else on the row hints that a word is a preposition, so a blank
 * `part_of_speech` simply means "not shown here" rather than "probably a
 * preposition".
 */
export function isPrepositionEntry(entry: { part_of_speech: string; content_type?: string }): boolean {
  if (entry.content_type && entry.content_type !== "word") return false;
  return normalizePos(entry.part_of_speech).includes("предлог");
}

/** The bare preposition, lower-cased, for table lookups. */
function normalizePreposition(word: string): string {
  return word.trim().toLowerCase().replace(/[.,;:!?]+$/g, "");
}

// ─── The case-government table ────────────────────────────────────────────
//
// A closed set of the ~35 prepositions a learner actually meets, grouped by
// the case they always take — except the nine "Wechselpräpositionen", whose
// case depends on the question: Wo? (location, no movement) → Dativ, Wohin?
// (direction, movement across a boundary) → Akkusativ.

const AKKUSATIV_PREPOSITIONS = ["durch", "für", "gegen", "ohne", "um", "bis", "entlang", "wider"];

const DATIV_PREPOSITIONS = ["aus", "bei", "mit", "nach", "seit", "von", "zu", "außer", "gegenüber", "entgegen", "ab"];

const GENITIV_PREPOSITIONS = [
  "während", "wegen", "trotz", "statt", "anstatt", "außerhalb", "innerhalb",
  "oberhalb", "unterhalb", "diesseits", "jenseits", "angesichts", "aufgrund",
  "anhand", "infolge", "mithilfe", "beiderseits",
];

const WECHSEL_PREPOSITIONEN = ["an", "auf", "hinter", "in", "neben", "über", "unter", "vor", "zwischen"];

export const PREPOSITION_CASE: Record<string, PrepositionCase> = Object.fromEntries([
  ...AKKUSATIV_PREPOSITIONS.map((p) => [p, "akkusativ" as const]),
  ...DATIV_PREPOSITIONS.map((p) => [p, "dativ" as const]),
  ...GENITIV_PREPOSITIONS.map((p) => [p, "genitiv" as const]),
  ...WECHSEL_PREPOSITIONEN.map((p) => [p, "wechsel" as const]),
]);

/** The case a preposition entry governs, or null when it isn't in the table. */
export function prepositionCaseFor(entry: { lemma?: string; headword?: string }): PrepositionCase | null {
  const key = normalizePreposition(entry.lemma || entry.headword || "");
  return PREPOSITION_CASE[key] ?? null;
}

// ─── Hints and explanations ────────────────────────────────────────────────
//
// Same two-text shape as the noun gender rules: `nudge` before the answer
// (points at the group, never states the case), `explanation` after (states
// it outright, with the Wo?/Wohin? split spelled out for Wechsel).

export function prepositionCaseHint(prepositionCase: PrepositionCase): string {
  switch (prepositionCase) {
    case "akkusativ":
      return "durch, für, gegen, ohne, um, bis — эта группа всегда требует один и тот же падеж.";
    case "dativ":
      return "aus, bei, mit, nach, seit, von, zu — эта группа тоже всегда требует один падеж, но другой.";
    case "genitiv":
      return "während, wegen, trotz, statt — более редкая, книжная группа со своим падежом.";
    case "wechsel":
      return "Двойного управления: an, auf, in, über, unter, vor, zwischen — падеж зависит от вопроса Wo? или Wohin?.";
  }
}

export function prepositionCaseExplanation(word: string, prepositionCase: PrepositionCase): string {
  switch (prepositionCase) {
    case "akkusativ":
      return `«${word}» всегда требует Akkusativ: durch den Park, für dich, ohne Auto.`;
    case "dativ":
      return `«${word}» всегда требует Dativ: mit dem Auto, nach der Schule, aus Deutschland.`;
    case "genitiv":
      return `«${word}» требует Genitiv: während des Tages, wegen des Wetters, trotz des Regens.`;
    case "wechsel":
      return `«${word}» — Wechselpräposition: Dativ на вопрос Wo? (in dem Haus — «где»), Akkusativ на вопрос Wohin? (in das Haus — «куда»).`;
  }
}

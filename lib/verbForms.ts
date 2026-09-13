// Shared logic for working with the irregular verb forms stored in
// `DictionaryEntry.forms` (praeteritum, partizip2, hilfsverb, trennbar).
//
// Used by the general dictionary (word rows, filters) and by the dedicated
// verb-table module — kept in one place so the irregular-stem list and the
// form labels do not drift into two copies.

/** Human-readable label for each key `forms` can carry. */
export const FORM_LABEL: Record<string, string> = {
  praeteritum: "Präteritum",
  partizip2: "Partizip II",
  hilfsverb: "вспом. глагол",
  trennbar: "отделяемая",
  komparativ: "сравнит.",
  superlativ: "превосх.",
};

// The part-of-speech labels come from the model in the learner's language;
// normalising to lowercase merges "Глагол" and "глагол" into one chip.
export function normalizePos(pos: string): string {
  return pos.trim().toLowerCase();
}

/** The learning-oriented groups shown in the verb trainer. */
export type GermanVerbClass = "weak" | "strong" | "mixed" | "special" | "impersonal";

export const GERMAN_VERB_CLASS_LABEL: Record<GermanVerbClass, string> = {
  weak: "слабый",
  strong: "сильный",
  mixed: "смешанный",
  special: "особый",
  impersonal: "безличный",
};

export const GERMAN_VERB_CLASS_HINT: Record<GermanVerbClass, string> = {
  weak: "Стандартное спряжение: основу обычно не нужно заучивать отдельно.",
  strong: "Меняет корневую гласную или имеет сильные формы Präteritum/Partizip II — лучше учить формы отдельно.",
  mixed: "Сочетает признаки слабых и сильных глаголов: формы нужно запомнить.",
  special: "Особый или вспомогательный глагол с нестандартной системой форм.",
  impersonal: "В обычной речи используется с es: es regnet, es schneit и т. п.",
};

const GERMAN_IRREGULAR_VERB_STEMS = new Set([
  "sein", "haben", "werden", "können", "müssen", "wollen", "sollen", "dürfen", "mögen", "wissen", "tun",
  "backen", "befehlen", "beginnen", "beißen", "bergen", "bersten", "bewegen", "biegen", "bieten", "binden",
  "bitten", "blasen", "bleiben", "braten", "brechen", "brennen", "bringen", "denken", "dreschen", "dringen",
  "empfehlen", "erlöschen", "erschrecken", "essen", "fahren", "fallen", "fangen", "fechten", "finden",
  "flechten", "fliegen", "fliehen", "fließen", "fressen", "frieren", "gären", "gebären", "geben", "gedeihen",
  "gehen", "gelingen", "gelten", "genesen", "genießen", "geschehen", "gewinnen", "gießen", "gleichen",
  "gleiten", "glimmen", "graben", "greifen", "halten", "hängen", "hauen", "heben", "heißen", "helfen",
  "kennen", "klingen", "kneifen", "kommen", "kriechen", "laden", "lassen", "laufen", "leiden", "leihen",
  "lesen", "liegen", "lügen", "mahlen", "meiden", "melken", "messen", "misslingen", "nehmen", "nennen",
  "pfeifen", "preisen", "quellen", "raten", "reiben", "reißen", "reiten", "rennen", "riechen", "ringen",
  "rinnen", "rufen", "salzen", "saufen", "saugen", "schaffen", "scheiden", "scheinen", "schelten", "scheren",
  "schieben", "schießen", "schlafen", "schlagen", "schleichen", "schleifen", "schließen", "schlingen",
  "schmeißen", "schmelzen", "schneiden", "schreiben", "schreien", "schreiten", "schweigen", "schwellen",
  "schwimmen", "schwinden", "schwingen", "schwören", "sehen", "senden", "singen", "sinken", "sinnen",
  "sitzen", "spinnen", "sprechen", "sprießen", "springen", "stechen", "stehen", "stehlen", "steigen",
  "sterben", "stinken", "stoßen", "streichen", "streiten", "tragen", "treffen", "treiben", "treten",
  "triefen", "trinken", "trügen", "verbieten", "verbleiben", "vergessen", "vergleichen", "verlassen",
  "verlieren", "vermeiden", "verstehen", "verschwinden", "verzeihen", "wachsen", "wägen", "waschen",
  "weichen", "weisen", "wenden", "werben", "werden", "werfen", "wiegen", "winden", "winken", "wissen",
  "ziehen", "zwingen", "fernsehen"
]);

// These are useful to separate from ordinary strong verbs: they are the
// forms learners most often have to memorise as a complete mini-paradigm.
const GERMAN_SPECIAL_VERB_STEMS = new Set([
  "sein", "haben", "werden", "wissen", "tun",
  "können", "müssen", "wollen", "sollen", "dürfen", "mögen",
]);

const GERMAN_MIXED_VERB_STEMS = new Set([
  "bringen", "denken", "kennen", "nennen", "rennen", "brennen",
  "senden", "wenden",
]);

const GERMAN_IMPERSONAL_VERBS = new Set([
  "regnen", "schneien", "hageln", "donnern", "blitzen", "nieseln", "graupeln",
]);

function hasGermanStem(norm: string, stems: Set<string>): boolean {
  for (const stem of stems) {
    if (norm === stem || norm.endsWith(stem)) return true;
  }
  return false;
}

/**
 * Classifies a German verb for practice, not for a linguistic dissertation.
 * The stored principal parts are used as a fallback, so newly imported verbs
 * are still classified even when they are not in the curated stem list.
 */
export function classifyGermanVerb(
  lemma: string,
  headword: string,
  forms: Record<string, string> = {},
): GermanVerbClass {
  const norm = (lemma || headword || "").toLowerCase().trim();
  if (!norm) return "weak";

  if (hasGermanStem(norm, GERMAN_IMPERSONAL_VERBS)) return "impersonal";
  if (hasGermanStem(norm, GERMAN_SPECIAL_VERB_STEMS)) return "special";
  if (hasGermanStem(norm, GERMAN_MIXED_VERB_STEMS)) return "mixed";
  if (hasGermanStem(norm, GERMAN_IRREGULAR_VERB_STEMS)) return "strong";

  const p2 = (forms.partizip2 || "").toLowerCase().trim();
  const pr = (forms.praeteritum || "").toLowerCase().trim();
  if (p2.endsWith("en") && !p2.endsWith("ten")) return "strong";
  if (pr && !pr.endsWith("te") && !pr.endsWith("ten")) return "strong";

  return "weak";
}

export function isIrregularGermanVerb(lemma: string, headword: string, forms: Record<string, string> = {}): boolean {
  return classifyGermanVerb(lemma, headword, forms) !== "weak";
}

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

export function isIrregularGermanVerb(lemma: string, headword: string, forms: Record<string, string> = {}): boolean {
  const norm = (lemma || headword || "").toLowerCase().trim();
  if (!norm) return false;

  for (const stem of GERMAN_IRREGULAR_VERB_STEMS) {
    if (norm === stem || norm.endsWith(stem)) return true;
  }

  const p2 = (forms.partizip2 || "").toLowerCase().trim();
  const pr = (forms.praeteritum || "").toLowerCase().trim();

  if (p2.endsWith("en") && !p2.endsWith("ten")) return true;
  if (pr && !pr.endsWith("te") && !pr.endsWith("ten")) return true;

  return false;
}

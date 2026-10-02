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

const GERMAN_SEPARABLE_PREFIXES = new Set([
  "ab", "an", "auf", "aus", "bei", "ein", "fest", "her", "hin", "los", "mit", "nach", "vor", "weg", "zu",
  "zurück", "zusammen", "dabei", "daran", "darauf", "davon", "dazu", "empor", "entgegen", "heim", "hinterher",
  "heraus", "herbei", "herein", "herum", "hinauf", "hinaus", "hinein", "hinweg", "voran", "vorbei", "voraus",
]);

function normalizeGermanForm(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

function isMarkedSeparable(value: string | undefined): boolean {
  return /^(1|true|ja|yes|да)$/iu.test((value ?? "").trim());
}

/**
 * Finds the detachable part in a present-tense form such as
 * `kaufe ein` → `ein` for `einkaufen`. The explicit `trennbar` marker is
 * required so prefixes that can also be inseparable are never guessed.
 */
export function getPresentSeparableSuffix(
  form: string,
  infinitive: string,
  trennbar?: string,
): string | null {
  if (!isMarkedSeparable(trennbar)) return null;

  const words = normalizeGermanForm(form).split(" ");
  const suffix = words.at(-1) ?? "";
  const normalizedInfinitive = normalizeGermanForm(infinitive).replace(/\s+/g, "");
  if (words.length < 2 || !GERMAN_SEPARABLE_PREFIXES.has(suffix) || !normalizedInfinitive.startsWith(suffix)) return null;
  return suffix;
}

/**
 * In Präsens, the wir and sie/Sie forms normally repeat the infinitive.
 * Separable verbs are compared against their base (`einkaufen` → `kaufen`),
 * while the detachable suffix remains part of the expected full answer.
 */
export function isPresentPluralInfinitive(
  pronoun: string,
  form: string,
  infinitive: string,
  trennbar?: string,
): boolean {
  const normalizedPronoun = pronoun.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, "");
  if (normalizedPronoun !== "wir" && normalizedPronoun !== "sie/sie") return false;

  const normalizedForm = normalizeGermanForm(form);
  const normalizedInfinitive = normalizeGermanForm(infinitive);
  if (normalizedForm === normalizedInfinitive) return true;

  const suffix = getPresentSeparableSuffix(form, infinitive, trennbar);
  if (!suffix) return false;
  const base = normalizedInfinitive.slice(suffix.length);
  const words = normalizedForm.split(" ");
  return words.length === 2 && words[0] === base && words[1] === suffix;
}

/** The learning-oriented groups shown in the verb trainer. */
export type GermanVerbClass = "weak" | "strong" | "mixed" | "special" | "impersonal";

/**
 * Applies the trainer's type-filter rules. Weak and strong describe the same
 * base conjugation choice, so selecting one replaces the other. The remaining
 * learning groups can be combined with either base choice.
 */
export function toggleGermanVerbClassSelection(
  selected: ReadonlySet<GermanVerbClass>,
  type: GermanVerbClass,
): Set<GermanVerbClass> {
  const next = new Set(selected);
  if (next.has(type)) {
    next.delete(type);
    return next;
  }

  if (type === "weak") next.delete("strong");
  if (type === "strong") next.delete("weak");
  next.add(type);
  return next;
}

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
  "können", "müssen", "wollen", "sollen", "dürfen", "mögen", "möchten", "moechten",
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
  // «kaufte ein»: the detached particle says nothing about the stem's class.
  const pr = (forms.praeteritum || "").toLowerCase().trim().split(/\s+/)[0];
  if (p2.endsWith("en") && !p2.endsWith("ten")) return "strong";
  if (pr && !pr.endsWith("te") && !pr.endsWith("ten")) return "strong";

  return "weak";
}

export function isIrregularGermanVerb(lemma: string, headword: string, forms: Record<string, string> = {}): boolean {
  return classifyGermanVerb(lemma, headword, forms) !== "weak";
}

// ─── Principal parts on screen (word modal, card back) ───────────────────────

/** The three answers a German verb is learned by, ready to print. */
export type GermanVerbSummary = {
  /** Книжное прошедшее: 3rd person singular, e.g. «backte». */
  praeteritum: string;
  /** Разговорное прошедшее with its auxiliary, e.g. «hat gebacken» / «ist gegangen». */
  perfekt: string;
  verbClass: GermanVerbClass;
  separable: boolean;
};

/** «hat gebacken» / «ist gegangen» — the auxiliary is half of what Partizip II is for. */
export function germanPerfekt(partizip2: string, hilfsverb: string): string {
  const p2 = partizip2.trim();
  if (!p2) return "";
  // An answer that already carries its auxiliary must not get a second one.
  if (/^(hat|ist|haben|sein)\s/iu.test(p2)) return p2.replace(/^haben\s/iu, "hat ").replace(/^sein\s/iu, "ist ");
  const aux = hilfsverb.trim().toLowerCase();
  if (aux === "sein") return `ist ${p2}`;
  if (aux === "haben") return `hat ${p2}`;
  // «haben/sein» — both are correct (e.g. schwimmen); show both rather than guess.
  if (/haben/.test(aux) && /sein/.test(aux)) return `hat/ist ${p2}`;
  return p2;
}

/** Forms are usable once the past, the participle and the auxiliary are all known. */
export function hasCompleteGermanVerbForms(forms: Record<string, string | undefined> | null | undefined): boolean {
  return Boolean(forms?.praeteritum?.trim() && forms?.partizip2?.trim() && forms?.hilfsverb?.trim());
}

export function summarizeGermanVerb(infinitive: string, forms: Record<string, string | undefined>): GermanVerbSummary | null {
  if (!hasCompleteGermanVerbForms(forms)) return null;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(forms)) if (v) clean[k] = v;
  return {
    praeteritum: clean.praeteritum.trim(),
    perfekt: germanPerfekt(clean.partizip2, clean.hilfsverb),
    verbClass: classifyGermanVerb(infinitive.replace(/^sich\s+/iu, ""), infinitive, clean),
    separable: isMarkedSeparable(clean.trennbar),
  };
}

/**
 * Whether a card front could be a German infinitive: one lowercase word
 * (optionally after «sich») ending in -n. Nouns are capitalised, phrases have
 * spaces, so this keeps AI lookups to real verb candidates; adjectives such as
 * «offen» slip through and are rejected by the forms endpoint.
 */
export function looksLikeGermanInfinitive(front: string): boolean {
  const word = front.trim().replace(/^sich\s+/u, "");
  return /^[a-zäöüß]{2,}(en|ern|eln|n)$/u.test(word) && word.length <= 30;
}

const FORM_KEY_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(FORM_LABEL).map(([key, label]) => [label.toLowerCase(), key]),
);
const VERB_DETAIL_KEYS = new Set(["praeteritum", "partizip2", "hilfsverb", "trennbar"]);

/**
 * Reads the forms a dictionary-made card already carries on its back
 * («Präteritum: backte · Partizip II: gebacken · вспом. глагол: haben») and
 * returns the details with those parts removed, so the verb line can replace
 * them instead of repeating them.
 */
export function extractVerbFormsFromDetails(details: string): { forms: Record<string, string>; rest: string } {
  const forms: Record<string, string> = {};
  const lines = details.split("\n").map((line) => {
    const parts = line.split(" · ").filter((part) => {
      const m = /^([^:]+):\s*(.+)$/u.exec(part.trim());
      const key = m ? FORM_KEY_BY_LABEL[m[1].trim().toLowerCase()] : undefined;
      if (!m || !key || !VERB_DETAIL_KEYS.has(key)) return true;
      forms[key] = m[2].trim();
      return false;
    });
    return parts.join(" · ");
  });
  return { forms, rest: lines.filter((l) => l.trim()).join("\n") };
}

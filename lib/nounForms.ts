// Shared logic for the noun half of the dictionary: the gender/article/plural
// fields every `DictionaryEntry` already carries, and the suffix rules that
// explain *why* a German noun has the gender it has.
//
// Used by the Артикли и Существительные module (table, filters, quiz, the
// rules cheat sheet) and by the dictionary rows, so the colour of a gender and
// the rule behind it are defined once rather than drifting into two copies.

import { normalizePos } from "@/lib/verbForms";

/** The four buckets a German noun can fall into. "pl" = plural-only word (die Eltern). */
export type NounGender = "m" | "f" | "n" | "pl";

export const GENDER_ORDER: NounGender[] = ["m", "f", "n", "pl"];

/** The article the learner actually has to produce — this is what is drilled. */
export const GENDER_ARTICLE: Record<NounGender, string> = {
  m: "der",
  f: "die",
  n: "das",
  pl: "die",
};

export const GENDER_LABEL: Record<NounGender, string> = {
  m: "мужской",
  f: "женский",
  n: "средний",
  pl: "только мн. ч.",
};

/** Chip text in the filter row: the article is what the learner recognises, not the letter. */
export const GENDER_CHIP: Record<NounGender, string> = {
  m: "der",
  f: "die",
  n: "das",
  pl: "die (Pl.)",
};

export function isNounEntry(partOfSpeech: string): boolean {
  return normalizePos(partOfSpeech).includes("существительное");
}

/**
 * The stored gender, or one inferred from a stored article when the gender
 * column was never filled in. A photographed page often gives «die Lösung»
 * without a separate gender field, and that article is the answer already.
 */
export function nounGender(entry: { gender?: string; article?: string; headword?: string }): NounGender | null {
  const raw = (entry.gender ?? "").trim().toLowerCase();
  if (raw === "m" || raw === "f" || raw === "n" || raw === "pl") return raw;

  const article = (entry.article ?? "").trim().toLowerCase();
  if (article === "der") return "m";
  if (article === "das") return "n";
  if (article === "die") return "f"; // «die» alone reads as feminine; plural-only words carry gender "pl"

  // Last resort: the headword was saved with its article glued on ("die Lösung").
  const lead = (entry.headword ?? "").trim().toLowerCase().split(/\s+/)[0];
  if (lead === "der") return "m";
  if (lead === "das") return "n";
  if (lead === "die") return "f";
  return null;
}

/** «der» / «die» / «das» for a row, or an empty string when nothing is known yet. */
export function nounArticle(entry: { gender?: string; article?: string; headword?: string }): string {
  const stored = (entry.article ?? "").trim();
  if (stored) return stored.toLowerCase();
  const gender = nounGender(entry);
  return gender ? GENDER_ARTICLE[gender] : "";
}

/** The bare noun with any leading article stripped — what goes in the Singular column. */
export function bareNoun(entry: { headword: string; lemma?: string }): string {
  const source = (entry.lemma || entry.headword || "").trim();
  return source.replace(/^(der|die|das)\s+/i, "");
}

// ─── Suffix rules ────────────────────────────────────────────────────────────
//
// German gender is unpredictable word by word but highly predictable by ending,
// and the ending is the only thing a learner can actually carry into an exam.
//
// Each rule carries two different texts on purpose:
//
//   `nudge`       — shown BEFORE the answer. It names the ending and the family
//                   of words it belongs to, with examples written WITHOUT their
//                   articles, and never states the gender. A hint that says
//                   "средний род" is not a hint, it is the answer.
//   `explanation` — shown AFTER answering. Now the articles, the reliability of
//                   the rule and its known exceptions are exactly what is
//                   wanted, so this one says everything outright.
//
// `exceptionNote` covers the case the table itself creates: «Messer» ends in
// -er but is neuter, and explaining it with "слова на -er мужского рода" would
// teach the wrong thing about the very word being asked. When a noun's real
// gender contradicts its own rule, the quiz shows this instead.

/** How reliable a rule is, in the learner's own terms. */
export type RuleConfidence = "always" | "high" | "usual";

export const CONFIDENCE_LABEL: Record<RuleConfidence, string> = {
  always: "без исключений",
  high: "почти всегда",
  usual: "чаще всего",
};

export type GenderRule = {
  /** Stable id — also the key the "слабые окончания" statistics are counted under. */
  id: string;
  /** How the rule is written in the cheat sheet: "-ung", "Ge-…". */
  label: string;
  gender: NounGender;
  confidence: RuleConfidence;
  /** What kind of words the rule covers, for the cheat sheet's subtitle. */
  family?: string;
  nudge: string;
  explanation: string;
  /** The ending itself. Empty for a prefix-only rule. */
  suffix: string;
  /** A prefix the word must also start with, for the Ge- rule. */
  prefix?: string;
  /**
   * Strong endings (2) beat the Ge- prefix (1), which beats the weak
   * catch-alls -e / -o / -er (0). Without this «das Gebäude» is read as a
   * feminine -e word and «das Dokument» as a masculine -ent one.
   */
  priority: 0 | 1 | 2;
};

/**
 * The whole table, in the order the cheat sheet shows it: feminine first
 * (the most reliable group), then masculine, then neuter.
 */
export const GENDER_RULES: GenderRule[] = [
  // ─ die ────────────────────────────────────────────────────────────────────
  {
    id: "ung", label: "-ung", gender: "f", confidence: "high", priority: 2, suffix: "ung",
    family: "отглагольные: процесс или результат",
    nudge: "Окончание -ung: отглагольные существительные, называющие процесс или результат (Bedeutung, Zeitung, Übung). Вспомните, какой род у всей этой группы.",
    explanation: "Слова на -ung — женского рода, почти без исключений: die Bedeutung, die Zeitung, die Übung.",
  },
  {
    id: "heit", label: "-heit", gender: "f", confidence: "always", priority: 2, suffix: "heit",
    family: "абстрактные качества",
    nudge: "Окончание -heit: абстрактные качества и состояния (Freiheit, Gesundheit). Это одна из самых надёжных групп — вспомните её род.",
    explanation: "Слова на -heit всегда женского рода: die Freiheit, die Gesundheit.",
  },
  {
    id: "keit", label: "-keit", gender: "f", confidence: "always", priority: 2, suffix: "keit",
    family: "абстрактные качества",
    nudge: "Окончание -keit — брат -heit: абстрактные качества (Möglichkeit, Einsamkeit). Род у них общий.",
    explanation: "Слова на -keit всегда женского рода: die Möglichkeit, die Einsamkeit.",
  },
  {
    id: "schaft", label: "-schaft", gender: "f", confidence: "always", priority: 2, suffix: "schaft",
    family: "сообщества и отношения",
    nudge: "Окончание -schaft: сообщества и отношения (Freundschaft, Gesellschaft, Mannschaft). Правило без исключений — вспомните какое.",
    explanation: "Слова на -schaft всегда женского рода: die Freundschaft, die Gesellschaft, die Mannschaft.",
  },
  {
    id: "ei", label: "-ei", gender: "f", confidence: "high", priority: 2, suffix: "ei",
    family: "места и занятия",
    nudge: "Окончание -ei: чаще всего места, где что-то делают (Bäckerei, Bücherei). У этой группы один общий род.",
    explanation: "Слова на -ei — женского рода: die Bäckerei, die Bücherei.",
  },
  {
    id: "in", label: "-in", gender: "f", confidence: "always", priority: 2, suffix: "in",
    family: "лица женского пола, профессии",
    nudge: "Окончание -in здесь обозначает лицо женского пола (Ärztin, Freundin, Lehrerin) — по смыслу род очевиден.",
    explanation: "Слова на -in, обозначающие лиц женского пола, всегда женского рода: die Ärztin, die Freundin.",
  },
  {
    id: "ion", label: "-ion", gender: "f", confidence: "high", priority: 2, suffix: "ion",
    family: "интернационализмы",
    nudge: "Окончание -ion — заимствование (Station, Information, Explosion). Все такие интернационализмы получают в немецком один и тот же род.",
    explanation: "Заимствования на -ion — женского рода: die Station, die Information, die Explosion.",
  },
  {
    id: "taet", label: "-tät", gender: "f", confidence: "always", priority: 2, suffix: "tät",
    family: "интернационализмы",
    nudge: "Окончание -tät — латинское заимствование (Universität, Qualität). Соответствует русским словам на «-ость», и род у группы один.",
    explanation: "Заимствования на -tät — женского рода: die Universität, die Qualität.",
  },
  {
    id: "ik", label: "-ik", gender: "f", confidence: "high", priority: 2, suffix: "ik",
    family: "интернационализмы",
    nudge: "Окончание -ik — заимствование (Musik, Politik, Mathematik). Вспомните род этой группы.",
    explanation: "Заимствования на -ik — женского рода: die Musik, die Politik.",
  },
  {
    id: "ur", label: "-ur", gender: "f", confidence: "high", priority: 2, suffix: "ur",
    family: "интернационализмы",
    nudge: "Окончание -ur — заимствование (Natur, Kultur, Literatur). У них общий род.",
    explanation: "Заимствования на -ur — женского рода: die Natur, die Kultur.",
  },
  {
    id: "anz", label: "-anz", gender: "f", confidence: "high", priority: 2, suffix: "anz",
    family: "интернационализмы",
    nudge: "Окончание -anz — заимствование (Eleganz, Distanz). Тот же род, что и у пары -enz.",
    explanation: "Заимствования на -anz — женского рода: die Eleganz, die Distanz.",
  },
  {
    id: "enz", label: "-enz", gender: "f", confidence: "high", priority: 2, suffix: "enz",
    family: "интернационализмы",
    nudge: "Окончание -enz — заимствование (Existenz, Konferenz). Тот же род, что и у пары -anz.",
    explanation: "Заимствования на -enz — женского рода: die Existenz, die Konferenz.",
  },
  {
    id: "ade", label: "-ade", gender: "f", confidence: "high", priority: 2, suffix: "ade",
    family: "заимствования",
    nudge: "Окончание -ade — заимствование (Schokolade, Marmelade, Limonade). У всей группы один род.",
    explanation: "Заимствования на -ade — женского рода: die Schokolade, die Marmelade.",
  },
  {
    id: "age", label: "-age", gender: "f", confidence: "high", priority: 2, suffix: "age",
    family: "французские заимствования",
    nudge: "Окончание -age — французское заимствование, читается «-ажэ» (Garage, Massage). Род у группы общий.",
    explanation: "Французские заимствования на -age — женского рода: die Garage, die Massage.",
  },
  {
    id: "ie", label: "-ie", gender: "f", confidence: "high", priority: 2, suffix: "ie",
    family: "заимствования и науки",
    nudge: "Окончание -ie — заимствование, часто название науки или отрасли (Familie, Biologie, Energie).",
    explanation: "Слова на -ie — женского рода: die Familie, die Biologie, die Energie.",
  },
  {
    id: "e", label: "-e", gender: "f", confidence: "usual", priority: 0, suffix: "e",
    family: "около 90% слов на -e",
    nudge: "Слово оканчивается на -e — это самая большая группа немецких существительных (Lampe, Katze, Sprache). Около 90% из них одного рода; исключения — люди (Kollege), животные (Löwe) и слова с приставкой Ge-.",
    explanation: "Около 90% слов на -e — женского рода: die Lampe, die Katze. Исключения: лица мужского пола (der Kollege), животные (der Löwe) и слова с приставкой Ge- (das Gebäude).",
  },

  // ─ der ────────────────────────────────────────────────────────────────────
  {
    id: "ismus", label: "-ismus", gender: "m", confidence: "always", priority: 2, suffix: "ismus",
    family: "учения и течения",
    nudge: "Окончание -ismus: учения и течения (Optimismus, Journalismus). Абсолютное правило без единого исключения.",
    explanation: "Слова на -ismus всегда мужского рода: der Optimismus, der Journalismus.",
  },
  {
    id: "ner", label: "-ner", gender: "m", confidence: "high", priority: 2, suffix: "ner",
    family: "деятели",
    nudge: "Окончание -ner: тот, кто чем-то занимается (Rentner, Gärtner). Тот же род, что у деятелей на -er.",
    explanation: "Слова на -ner — мужского рода: der Rentner, der Gärtner.",
  },
  {
    id: "ling", label: "-ling", gender: "m", confidence: "always", priority: 2, suffix: "ling",
    family: "носители признака",
    nudge: "Окончание -ling (Frühling, Schmetterling, Lehrling). Правило работает без исключений — вспомните какое.",
    explanation: "Слова на -ling всегда мужского рода: der Frühling, der Schmetterling.",
  },
  {
    id: "ig", label: "-ig", gender: "m", confidence: "high", priority: 2, suffix: "ig",
    family: "короткие исконные слова",
    nudge: "Окончание -ig (Honig, König, Essig). Небольшая, но устойчивая группа с общим родом.",
    explanation: "Слова на -ig — мужского рода: der Honig, der König.",
  },
  {
    id: "ich", label: "-ich", gender: "m", confidence: "high", priority: 2, suffix: "ich",
    family: "короткие исконные слова",
    nudge: "Окончание -ich (Teppich, Rettich). Та же группа, что и -ig.",
    explanation: "Слова на -ich — мужского рода: der Teppich, der Rettich.",
  },
  {
    id: "ant", label: "-ant", gender: "m", confidence: "high", priority: 2, suffix: "ant",
    family: "лица, заимствования",
    nudge: "Окончание -ant — заимствование, чаще всего лицо (Praktikant, Demonstrant) — или Elefant. Слабое склонение, и род у группы один.",
    explanation: "Заимствования на -ant — мужского рода: der Praktikant, der Elefant.",
  },
  {
    id: "ent", label: "-ent", gender: "m", confidence: "high", priority: 2, suffix: "ent",
    family: "лица, заимствования",
    nudge: "Окончание -ent — лицо-заимствование (Student, Patient, Präsident). Не путайте с более длинным -ment: там другая группа.",
    explanation: "Заимствования на -ent, обозначающие лиц, — мужского рода: der Student, der Patient.",
  },
  {
    id: "ist", label: "-ist", gender: "m", confidence: "high", priority: 2, suffix: "ist",
    family: "лица, заимствования",
    nudge: "Окончание -ist — лицо-заимствование (Polizist, Tourist, Journalist). Тот же ряд, что -ant и -ent.",
    explanation: "Заимствования на -ist — мужского рода: der Polizist, der Tourist.",
  },
  {
    id: "eur", label: "-eur", gender: "m", confidence: "high", priority: 2, suffix: "eur",
    family: "французские заимствования, профессии",
    nudge: "Окончание -eur — французская профессия (Friseur, Ingenieur). Деятель, а значит и род как у деятелей.",
    explanation: "Заимствования на -eur — мужского рода: der Friseur, der Ingenieur.",
  },
  {
    id: "or", label: "-or", gender: "m", confidence: "high", priority: 2, suffix: "or",
    family: "латинские заимствования",
    nudge: "Окончание -or — латинское заимствование, деятель или механизм (Motor, Autor, Professor).",
    explanation: "Заимствования на -or — мужского рода: der Motor, der Autor.",
  },
  {
    id: "er", label: "-er", gender: "m", confidence: "usual", priority: 0, suffix: "er",
    family: "деятели, инструменты",
    nudge: "Окончание -er: тот или то, что выполняет действие (Lehrer, Computer, Fahrer). Большая группа с общим родом — но и с известными исключениями (Messer, Mutter, Fenster).",
    explanation: "Деятели и инструменты на -er — мужского рода: der Lehrer, der Computer. Известные исключения: das Messer, das Fenster, die Mutter.",
  },

  // ─ das ────────────────────────────────────────────────────────────────────
  {
    id: "chen", label: "-chen", gender: "n", confidence: "always", priority: 2, suffix: "chen",
    family: "уменьшительные",
    nudge: "Окончание -chen — уменьшительная форма (Mädchen, Brötchen). Уменьшительные в немецком всегда одного рода, каким бы ни было исходное слово.",
    explanation: "Уменьшительные на -chen всегда среднего рода: das Mädchen, das Brötchen — даже когда исходное слово другого рода (die Frau → das Frauchen).",
  },
  {
    id: "lein", label: "-lein", gender: "n", confidence: "always", priority: 2, suffix: "lein",
    family: "уменьшительные",
    nudge: "Окончание -lein — вторая уменьшительная форма (Fräulein, Büchlein). Работает так же, как -chen.",
    explanation: "Уменьшительные на -lein всегда среднего рода: das Fräulein, das Büchlein.",
  },
  {
    id: "tum", label: "-tum", gender: "n", confidence: "high", priority: 2, suffix: "tum",
    family: "абстрактные и собирательные",
    nudge: "Окончание -tum: абстрактные и собирательные понятия (Eigentum, Altertum, Christentum). Почти вся группа одного рода — кроме пары известных исключений про богатство и заблуждение.",
    explanation: "Слова на -tum — среднего рода: das Eigentum, das Christentum. Исключения: der Reichtum и der Irrtum.",
  },
  {
    id: "ment", label: "-ment", gender: "n", confidence: "high", priority: 2, suffix: "ment",
    family: "латинские заимствования",
    nudge: "Окончание -ment — заимствование (Dokument, Instrument, Medikament). Обратите внимание: это длиннее, чем -ent, и группа другая.",
    explanation: "Заимствования на -ment — среднего рода: das Dokument, das Instrument.",
  },
  {
    id: "ma", label: "-ma", gender: "n", confidence: "high", priority: 2, suffix: "ma",
    family: "греческие заимствования",
    nudge: "Окончание -ma — греческое заимствование (Thema, Drama, Klima). Небольшая группа с общим родом.",
    explanation: "Греческие заимствования на -ma — среднего рода: das Thema, das Drama.",
  },
  {
    id: "um", label: "-um", gender: "n", confidence: "high", priority: 2, suffix: "um",
    family: "латинские заимствования",
    nudge: "Окончание -um — латинское заимствование (Zentrum, Museum, Datum). Во множественном числе -um меняется на -en.",
    explanation: "Латинские заимствования на -um — среднего рода: das Zentrum, das Museum (мн. ч. die Zentren, die Museen).",
  },
  {
    id: "ing", label: "-ing", gender: "n", confidence: "high", priority: 2, suffix: "ing",
    family: "английские заимствования",
    nudge: "Окончание -ing — английское заимствование (Training, Shopping, Meeting). Все свежие англицизмы этого вида получают один и тот же род.",
    explanation: "Английские заимствования на -ing — среднего рода: das Training, das Shopping.",
  },
  {
    id: "o", label: "-o", gender: "n", confidence: "usual", priority: 0, suffix: "o",
    family: "заимствования",
    nudge: "Слово оканчивается на -o — почти всегда заимствование (Auto, Kino, Radio, Foto). У этой группы общий род.",
    explanation: "Заимствования на -o — среднего рода: das Auto, das Kino, das Radio.",
  },
  {
    id: "ge", label: "Ge-…", gender: "n", confidence: "usual", priority: 1, suffix: "", prefix: "ge",
    family: "приставка Ge-: совокупность или процесс",
    nudge: "Слово начинается с приставки Ge- — она собирает вещи в совокупность или называет процесс (Gebäude, Gespräch, Gepäck). У таких слов свой род, независимо от окончания.",
    explanation: "Существительные с приставкой Ge- (совокупность или процесс) — среднего рода: das Gebäude, das Gespräch, das Gepäck. Исключения есть — например, die Geschichte.",
  },
];

/**
 * The rule that best fits this word, or null when its ending says nothing.
 *
 * Strongest rule wins: first by priority (so «Gebäude» is read as a Ge- word
 * and not as an -e word), then by how much of the word the ending actually
 * covers (so «Dokument» is -ment, not -ent).
 */
export function suffixRuleFor(word: string): GenderRule | null {
  const norm = bareNoun({ headword: word }).toLowerCase();
  if (!norm) return null;

  let best: GenderRule | null = null;
  for (const rule of GENDER_RULES) {
    if (rule.prefix && !norm.startsWith(rule.prefix)) continue;
    if (rule.suffix) {
      if (!norm.endsWith(rule.suffix)) continue;
      // The word must be longer than its own ending — "der Or" is not an -or word.
      if (norm.length <= rule.suffix.length) continue;
    } else if (norm.length <= (rule.prefix?.length ?? 0) + 1) {
      continue;
    }
    if (!best
      || rule.priority > best.priority
      || (rule.priority === best.priority && rule.suffix.length > best.suffix.length)) {
      best = rule;
    }
  }
  return best;
}

/**
 * The nudge shown before the answer: what family the word belongs to, without
 * ever naming the gender. Null when nothing in the ending helps.
 */
export function genderRuleHint(word: string): string | null {
  return suffixRuleFor(word)?.nudge ?? null;
}

/**
 * The debrief shown after answering — now with articles, reliability and the
 * exceptions spelled out.
 *
 * When the word's real gender contradicts its own rule (das Messer, der
 * Reichtum, die Geschichte) the rule's explanation would teach exactly the
 * wrong thing about this word, so it is replaced by the exception itself.
 */
export function genderRuleExplanation(word: string, actual: NounGender | null): string | null {
  const rule = suffixRuleFor(word);
  if (!rule) return null;
  if (actual && actual !== rule.gender) {
    const bare = bareNoun({ headword: word });
    const body = `Обычно ${rule.explanation.charAt(0).toLowerCase()}${rule.explanation.slice(1)}`;
    // Several rules already name their own famous exceptions; repeating «это
    // слово в группу не попадает» right after the sentence that just listed it
    // reads as the explanation not knowing what it said a line earlier.
    const alreadyNamed = rule.explanation.includes(bare);
    return `«${bare}» — исключение. ${body}${alreadyNamed ? "" : " Это слово в группу не попадает — его придётся запомнить отдельно."}`;
  }
  return rule.explanation;
}

/** What the ending predicts, when it predicts anything. */
export function predictGender(word: string): NounGender | null {
  return suffixRuleFor(word)?.gender ?? null;
}

/** Russian plural agreement for «существительное» — the same shape verbNoun() has. */
export function nounWordForm(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "существительных";
  if (mod10 === 1) return "существительное";
  if (mod10 >= 2 && mod10 <= 4) return "существительных";
  return "существительных";
}

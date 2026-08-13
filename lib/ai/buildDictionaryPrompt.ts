// Reading a photograph into dictionary entries.
//
// Two very different pages arrive here and both must work:
//
//   1. A vocabulary list from a coursebook — "der Ball, ¨e", "die Kosten (Pl.)".
//      These are the words the learner has been *assigned*. Every single one
//      must come back, in the order printed, with nothing added and nothing
//      dropped. Inventing a word here is worse than useless: it puts something
//      on the revision list that the course never asked for.
//
//   2. An ordinary page of text — a book, a letter, a sign. Then the entries
//      are the words worth looking up, drawn only from what is actually on the
//      page.
//
// Either way the entry is what a printed dictionary would show: headword with
// its article, plural, the irregular verb forms, a translation, and the CEFR
// level — the "cheat sheet" a learner needs to use the word correctly rather
// than merely recognise it.

export type DictionaryEntryDraft = {
  headword: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
  gender: string;
  article: string;
  plural: string;
  forms?: Record<string, string>;
  cefr: string;
  note?: string;
  example?: string;
  exampleTranslation?: string;
};

export function buildDictionaryFromImagePrompt(params: {
  targetLanguage: string;
  nativeLanguage: string;
  /** Free-text instruction from the learner; outranks the defaults below. */
  note?: string;
}): string {
  const { targetLanguage: target, nativeLanguage: native } = params;
  const note = (params.note ?? "").trim();

  return `You are building dictionary entries for a language learner from a photograph of a page.
The learner is studying ${target}. Their native language is ${native}.

FIRST decide what the page is:

A) A VOCABULARY LIST or glossary — a course word list, a textbook "Wortschatz" page, a
   two-column word/translation table, a set of words with articles and plural markers.
   Then: return EVERY word printed on the page, in the order printed. This is the
   learner's assigned vocabulary; a missing word is a word they will not study, and an
   invented word is one the course never set. Do not select, do not summarise, do not
   add related words, do not skip words you consider easy. Include words from every
   column and every section (nouns, verbs, adjectives, other words).

B) ANY OTHER TEXT — a page of a book, a letter, a document, a sign.
   Then: return the words worth looking up, taken only from the text in the photo.
   Cover the content words — nouns, verbs, adjectives, adverbs and fixed expressions —
   and skip bare function words (articles, basic pronouns, prepositions like "in", "auf")
   unless they are used in a way worth explaining. Never invent vocabulary that is not on
   the page.

For EVERY entry provide:
- "headword": how a dictionary would print it in ${target}. For a noun, include the
  article: "die Öffnungszeit". For a verb, the infinitive. Keep the original spelling
  exactly, including umlauts and ß.
- "lemma": the bare base form with no article and no markers: "Öffnungszeit", "einladen".
- "translation": the translation into ${native}. When the page already gives one, use the
  page's translation. When a word has clearly distinct common meanings, give the main one
  first and the others after a comma — briefly.
- "partOfSpeech": in ${native} — "существительное", "глагол", "прилагательное", "наречие",
  "предлог", "союз", "местоимение", "числительное", "выражение".
- "gender": for nouns only — "m", "f", "n", or "pl" for plural-only words. Empty otherwise.
- "article": for nouns only — the definite article ("der", "die", "das"). Empty otherwise.
- "plural": for nouns — the full plural form, written out: for "der Ball, ¨e" that is
  "die Bälle"; for "das Mädchen, -" that is "die Mädchen"; for "die Kosten (Pl.)" write
  "только мн. ч.". Expand the page's shorthand markers into the real form — the marker is
  what the learner cannot yet read. Empty for non-nouns.
- "forms": for verbs, an object with "praeteritum", "partizip2", "hilfsverb" ("haben" or
  "sein"), and "trennbar" ("да"/"нет") — for ${target} other than German, the equivalent
  principal parts under sensible keys. For adjectives with irregular comparison, use
  "komparativ" and "superlativ". Empty object when there is nothing irregular to show.
- "cefr": the CEFR level of the word itself — one of A1, A2, B1, B2, C1, C2.
  * For basic everyday vocabulary (hobbies, food, daily routines, basic actions like "grillen", "baden", "ausgehen", "träumen", "kochen", "wohnen", "einkaufen", "Möbel", "Balkon", "Picknick", "Kosten", "Treffpunkt"), assign "A1".
  * Do NOT over-estimate beginner words to A2 or B1. If the photo comes from an elementary coursebook page (e.g. A1/A2), words taught on that page belong to that course's CEFR level unless clearly advanced.
- "note": at most one short line in ${native} — only when something would trip the learner
  up: a false friend, a required case or preposition ("+ Dativ"), a fixed expression.
  Leave empty when there is nothing to warn about.
- "example": one short natural sentence in ${target} using the word. If the page gives an
  example, prefer the page's.
- "exampleTranslation": that sentence in ${native}.
${note ? `
The learner asked for this specifically. It outranks the rules above:
"""
${note.slice(0, 500)}
"""
` : ""}
Rules:
- Transcribe from the photo only. Never guess at a word that is cut off or illegible —
  leave it out entirely rather than inventing a plausible one.
- No duplicates: one entry per word.
- "pageKind" describes what you decided the page is, in ${native} ("список слов из учебника",
  "страница книги").
- "topic" is what the words are about, in ${native}, two or three words — "свободное время",
  "аренда жилья", "погода и природа". It becomes the name of this batch in the learner's
  dictionary, so it has to be recognisable a month later. Empty only if the words share nothing.
- "pageLabel" is any page or unit number printed on the page ("стр. 56", "Lektion 4"), or empty.

Return ONLY valid JSON:
{
  "pageKind": "…",
  "topic": "…",
  "pageLabel": "…",
  "isVocabularyList": true,
  "entries": [ { "headword": "…", "lemma": "…", "translation": "…", "partOfSpeech": "…",
                 "gender": "…", "article": "…", "plural": "…", "forms": {},
                 "cefr": "A1", "note": "", "example": "…", "exampleTranslation": "…" } ]
}`;
}

const CEFR_VALUES = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const GENDERS = new Set(["m", "f", "n", "pl"]);

const A1_DICTIONARY_WORDS = new Set([
  "grillen", "picknick", "möbel", "balkon", "garage", "heizung", "keller", "miete", "mieter", "mieterin",
  "vermieter", "nachbar", "mieten", "aussehen", "dunkel", "hell", "hoch", "modern", "ruhig", "cafeteria",
  "sofort", "pilz", "bohne", "schneiden", "probieren", "riechen", "eintritt", "ermäßigung", "treffpunkt",
  "öffnungszeit", "heimat", "wanderung", "fit", "kosten", "unterschrift", "jugendliche", "erzieher", "erzieherin",
  "monatlich", "renovieren", "ausgehen", "träumen", "feierabend", "notiz", "wäsche", "fahrplan", "käsebrötchen",
  "schinkenbrötchen", "anzeige", "schild", "bedienung", "menge", "fast", "genau", "erlaubt", "verboten", "lieber", "rund"
]);

/** Narrow the model's raw JSON into entries worth storing. */
export function parseDictionaryEntries(raw: unknown): {
  entries: DictionaryEntryDraft[];
  pageKind: string;
  topic: string;
  pageLabel: string;
  isVocabularyList: boolean;
} {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.entries) ? obj.entries : [];

  const seen = new Set<string>();
  const entries: DictionaryEntryDraft[] = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;

    const headword = String(e.headword ?? "").trim().slice(0, 200);
    const lemmaRaw = String(e.lemma ?? "").trim().slice(0, 200);
    // A headword without a lemma is still usable: strip the article ourselves.
    const lemma = (lemmaRaw || headword.replace(/^(der|die|das|the|le|la|el)\s+/i, "")).trim();
    if (!headword || !lemma) continue;

    const key = lemma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const forms: Record<string, string> = {};
    if (typeof e.forms === "object" && e.forms !== null) {
      for (const [k, v] of Object.entries(e.forms as Record<string, unknown>)) {
        const value = String(v ?? "").trim();
        if (value) forms[k.slice(0, 30)] = value.slice(0, 120);
      }
    }

    let cefr = String(e.cefr ?? "").trim().toUpperCase();
    if (A1_DICTIONARY_WORDS.has(key)) {
      cefr = "A1";
    }
    const gender = String(e.gender ?? "").trim().toLowerCase();

    entries.push({
      headword,
      lemma,
      translation: String(e.translation ?? "").trim().slice(0, 400),
      partOfSpeech: String(e.partOfSpeech ?? "").trim().slice(0, 60),
      gender: GENDERS.has(gender) ? gender : "",
      article: String(e.article ?? "").trim().slice(0, 20),
      plural: String(e.plural ?? "").trim().slice(0, 120),
      forms,
      cefr: CEFR_VALUES.has(cefr) ? cefr : "A1",
      note: String(e.note ?? "").trim().slice(0, 300),
      example: String(e.example ?? "").trim().slice(0, 400),
      exampleTranslation: String(e.exampleTranslation ?? "").trim().slice(0, 400),
    });
  }

  return {
    entries,
    pageKind: String(obj.pageKind ?? "").trim().slice(0, 120),
    topic: String(obj.topic ?? "").trim().slice(0, 80),
    pageLabel: String(obj.pageLabel ?? "").trim().slice(0, 40),
    isVocabularyList: obj.isVocabularyList === true,
  };
}

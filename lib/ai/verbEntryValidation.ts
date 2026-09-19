import type { DictionaryEntryDraft } from "./buildDictionaryPrompt";

const VERB_POS = /глагол|verb|verbo|verbe|verbo/iu;
const VERB_FORM_KEYS = ["praeteritum", "partizip2", "hilfsverb", "trennbar"] as const;
const AUXILIARIES = new Set(["haben", "sein"]);
const SEPARABLE_VALUES = new Set(["да", "нет", "ja", "nein", "yes", "no", "true", "false"]);

type GermanVerbForms = Record<string, string>;

const CANONICAL_LEMMAS: Record<string, string> = {
  möchten: "mögen",
  moechten: "mögen",
  möchte: "mögen",
  moechte: "mögen",
};

// These are high-confidence lexical exceptions that must never depend on a
// model filling a field opportunistically. They also repair old smart packs
// whose modal/special verb row was stored incomplete.
const AUTHORITATIVE_GERMAN_FORMS: Record<string, GermanVerbForms> = {
  sein: { praeteritum: "war", partizip2: "gewesen", hilfsverb: "sein", trennbar: "нет" },
  haben: { praeteritum: "hatte", partizip2: "gehabt", hilfsverb: "haben", trennbar: "нет" },
  werden: { praeteritum: "wurde", partizip2: "geworden", hilfsverb: "sein", trennbar: "нет" },
  können: { praeteritum: "konnte", partizip2: "gekonnt", hilfsverb: "haben", trennbar: "нет" },
  müssen: { praeteritum: "musste", partizip2: "gemusst", hilfsverb: "haben", trennbar: "нет" },
  wollen: { praeteritum: "wollte", partizip2: "gewollt", hilfsverb: "haben", trennbar: "нет" },
  sollen: { praeteritum: "sollte", partizip2: "gesollt", hilfsverb: "haben", trennbar: "нет" },
  dürfen: { praeteritum: "durfte", partizip2: "gedurft", hilfsverb: "haben", trennbar: "нет" },
  mögen: { praeteritum: "mochte", partizip2: "gemocht", hilfsverb: "haben", trennbar: "нет" },
  wissen: { praeteritum: "wusste", partizip2: "gewusst", hilfsverb: "haben", trennbar: "нет" },
  tun: { praeteritum: "tat", partizip2: "getan", hilfsverb: "haben", trennbar: "нет" },
};

function isGerman(language: string): boolean {
  return /^(de|german|deutsch|немецкий)$/iu.test(language.trim());
}

function normalizedKey(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE");
}

function isVerb(entry: DictionaryEntryDraft): boolean {
  const key = normalizedKey(entry.lemma || entry.headword);
  return VERB_POS.test(entry.partOfSpeech)
    || VERB_FORM_KEYS.some((key) => Boolean(entry.forms?.[key]))
    || Boolean(CANONICAL_LEMMAS[key] || AUTHORITATIVE_GERMAN_FORMS[key]);
}

function missingGermanVerbFields(forms: GermanVerbForms): string[] {
  const missing: string[] = VERB_FORM_KEYS.filter((key) => !forms[key]?.trim());
  if (forms.hilfsverb && !AUXILIARIES.has(forms.hilfsverb.trim().toLocaleLowerCase("de-DE"))) missing.push("hilfsverb (haben|sein)");
  if (forms.trennbar && !SEPARABLE_VALUES.has(forms.trennbar.trim().toLocaleLowerCase("de-DE"))) missing.push("trennbar (да|нет)");
  return missing;
}

export function normalizeGermanVerbEntry(entry: DictionaryEntryDraft): DictionaryEntryDraft {
  if (!isVerb(entry)) return entry;

  const sourceLemma = (entry.lemma || entry.headword).trim();
  const canonicalLemma = CANONICAL_LEMMAS[normalizedKey(sourceLemma)] ?? sourceLemma;
  const authoritative = AUTHORITATIVE_GERMAN_FORMS[normalizedKey(canonicalLemma)];
  const forms: GermanVerbForms = { ...(entry.forms ?? {}) };

  if (authoritative) {
    for (const key of VERB_FORM_KEYS) {
      if (!forms[key]?.trim()) forms[key] = authoritative[key];
    }
  }

  const shouldReplaceHeadword = CANONICAL_LEMMAS[normalizedKey(entry.headword)] !== undefined
    || normalizedKey(entry.headword) === normalizedKey(sourceLemma);

  return {
    ...entry,
    lemma: canonicalLemma,
    headword: shouldReplaceHeadword ? canonicalLemma : entry.headword,
    partOfSpeech: entry.partOfSpeech.trim() ? entry.partOfSpeech : "глагол",
    forms,
  };
}

export function validateGermanVerbEntries(
  entries: DictionaryEntryDraft[],
  targetLanguage: string,
): { entries: DictionaryEntryDraft[]; invalidVerbs: string[] } {
  if (!isGerman(targetLanguage)) return { entries, invalidVerbs: [] };

  const normalized = entries.map(normalizeGermanVerbEntry);
  const invalidVerbs = normalized
    .filter(isVerb)
    .flatMap((entry) => {
      const missing = missingGermanVerbFields(entry.forms ?? {});
      return missing.length > 0 ? [`${entry.lemma || entry.headword}: ${missing.join(", ")}`] : [];
    });

  return { entries: normalized, invalidVerbs };
}

export function germanVerbContractText(targetLanguage: string): string {
  if (!isGerman(targetLanguage)) return "";
  return `
GERMAN VERB CONTRACT — mandatory, machine-checked:
- Every item whose partOfSpeech is "глагол" must use the canonical infinitive in headword and lemma, never a conjugated form. For example, "möchten" is not an infinitive: return "mögen".
- Every German verb must always include a non-empty forms object with all four non-empty fields: praeteritum (3rd person singular), partizip2 (bare participle), hilfsverb (exactly haben or sein), trennbar (exactly да or нет). This is required for weak, strong, mixed, modal, auxiliary, and special verbs alike.
- Do not omit forms for regular/weak verbs. Do not put "hat/ist" or a pronoun into partizip2; it must be only the participle such as "gemacht" or "gegangen".
- If any verb field cannot be supplied with confidence, return no entries and explain the ambiguity in clarification; never return a partial verb row.`;
}

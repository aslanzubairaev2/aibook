import type { PosTag } from "@/lib/types";

export type FastWordInfo = {
  word: string;
  translation: string;
  partOfSpeech: PosTag;
  verbForms?: [string, string, string];
  article?: string;
  plural?: string;
  baseForm?: string;
  shortInfo?: string;
};

export function buildFastWordPrompt(params: { word: string; sentence: string; nativeLanguage: string; targetLanguage: string }) {
  return [
    "Fast dictionary lookup for a learner of " + params.targetLanguage + ". Native language: " + params.nativeLanguage + ".",
    "Word: \"" + params.word + "\"",
    "Context: \"" + params.sentence + "\"",
    "Return ONLY compact JSON, no examples or explanations.",
    "Shape: {\"word\":\"original\",\"translation\":\"short translation\",\"partOfSpeech\":\"verb|noun|adjective|adverb|pronoun|numeral|other\",\"verbForms\":[\"infinitive\",\"simple past\",\"past participle\"],\"article\":\"noun article or empty\",\"plural\":\"noun plural or empty\",\"baseForm\":\"useful base form or empty\",\"shortInfo\":\"one short note or empty\"}",
    "For verbs return exactly three verbForms. For nouns return article and plural. Keep values short.",
  ].join("\n");
}

const POS_TAGS = new Set<PosTag>(["verb", "noun", "adjective", "adverb", "pronoun", "numeral", "other"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function normalizeFastWordInfo(value: unknown, fallbackWord: string): FastWordInfo {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const partOfSpeech = POS_TAGS.has(raw.partOfSpeech as PosTag) ? raw.partOfSpeech as PosTag : "other";
  const forms = Array.isArray(raw.verbForms) ? raw.verbForms.map(text).slice(0, 3) : [];
  return {
    word: text(raw.word) || fallbackWord, translation: text(raw.translation), partOfSpeech,
    ...(partOfSpeech === "verb" && forms.length === 3 ? { verbForms: forms as [string, string, string] } : {}),
    ...(partOfSpeech === "noun" && text(raw.article) ? { article: text(raw.article) } : {}),
    ...(partOfSpeech === "noun" && text(raw.plural) ? { plural: text(raw.plural) } : {}),
    ...(partOfSpeech !== "verb" && partOfSpeech !== "noun" && text(raw.baseForm) ? { baseForm: text(raw.baseForm) } : {}),
    ...(text(raw.shortInfo) ? { shortInfo: text(raw.shortInfo) } : {}),
  };
}

export function parseFastWordJson(raw: string, fallbackWord: string): FastWordInfo {
  const cleaned = raw.trim();
  try { return normalizeFastWordInfo(JSON.parse(cleaned), fallbackWord); } catch {
    const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return normalizeFastWordInfo(JSON.parse(cleaned.slice(start, end + 1)), fallbackWord);
    throw new Error("AI returned invalid fast word JSON");
  }
}

const FAST_WORD_CACHE_KEY = "aibook_fast_word_cache_v1";
type CacheEntry = { key: string; value: FastWordInfo };

function cacheKey(word: string, targetLanguage: string, nativeLanguage: string) {
  return word.trim().toLocaleLowerCase() + ":" + targetLanguage + ":" + nativeLanguage;
}

export function getFastWordCache(word: string, targetLanguage: string, nativeLanguage: string): FastWordInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const entries = JSON.parse(localStorage.getItem(FAST_WORD_CACHE_KEY) || "[]") as CacheEntry[];
    return entries.find((entry) => entry.key === cacheKey(word, targetLanguage, nativeLanguage))?.value ?? null;
  } catch {
    return null;
  }
}

export function saveFastWordCache(word: string, targetLanguage: string, nativeLanguage: string, value: FastWordInfo) {
  if (typeof window === "undefined") return;
  try {
    const entries = JSON.parse(localStorage.getItem(FAST_WORD_CACHE_KEY) || "[]") as CacheEntry[];
    const key = cacheKey(word, targetLanguage, nativeLanguage);
    const next = entries.filter((entry) => entry.key !== key);
    next.push({ key, value });
    localStorage.setItem(FAST_WORD_CACHE_KEY, JSON.stringify(next.slice(-300)));
  } catch {
    // A full/private localStorage must not break word lookup.
  }
}

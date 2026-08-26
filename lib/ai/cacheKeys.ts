import type { AiMode } from "@/lib/types";

export function normalizeAiCacheText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function makeAiCacheKey(
  // "reverse-word" is the lookup run the other way round — a native word, and
  // how to say it. Its answer is in the other language entirely, so it must
  // never share a key with the ordinary analysis of the same spelling.
  mode: AiMode | "discuss" | "reverse-word",
  text: string,
  targetLanguage: string,
  nativeLanguage: string,
) {
  return `v2:${mode}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

export function makeDiscussCacheKey(mode: AiMode, text: string, targetLanguage: string, nativeLanguage: string) {
  return `v2:discuss:${mode}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

export function makeGrammarCacheKey(
  text: string,
  detail: "brief" | "full",
  targetLanguage: string,
  nativeLanguage: string,
) {
  // v3: the full verb matrix gained a Präteritum row above Perfekt — bump so a
  // learner who already cached the old 3-row table gets the new shape instead
  // of the incomplete one sticking around forever.
  return `v3:grammar:${detail}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

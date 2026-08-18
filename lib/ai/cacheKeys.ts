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
  return `v2:grammar:${detail}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

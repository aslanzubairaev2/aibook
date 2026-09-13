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

/**
 * A word's sense, tense and separable-prefix reading can change with the
 * sentence around it. Keep that occurrence-level analysis out of the
 * dictionary cache, whose key intentionally contains only the spelling.
 */
export function makeWordContextCacheKey(
  word: string,
  sentence: string,
  sentenceBefore: string,
  sentenceAfter: string,
  targetLanguage: string,
  nativeLanguage: string,
) {
  const context = [word, sentenceBefore, sentence, sentenceAfter]
    .map(normalizeAiCacheText)
    .join("|");
  return `v3:word-context:${context}:${targetLanguage}:${nativeLanguage}`;
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
  // v4: brief verb tables now skip persons an impersonal/usage-restricted verb
  // (dauern, regnen) is never actually said in — bump so an already-cached
  // "full sheet" for one of those gets replaced instead of sticking around.
  return `v4:grammar:${detail}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

export function makeVerbPhraseCacheKey(text: string, targetLanguage: string, nativeLanguage: string) {
  return `v1:verb-phrase:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

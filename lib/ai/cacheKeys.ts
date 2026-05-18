import type { AiMode } from "@/lib/types";

export function normalizeAiCacheText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function makeAiCacheKey(mode: AiMode | "discuss", text: string, targetLanguage: string, nativeLanguage: string) {
  return `v2:${mode}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

export function makeDiscussCacheKey(mode: AiMode, text: string, targetLanguage: string, nativeLanguage: string) {
  return `v2:discuss:${mode}:${normalizeAiCacheText(text)}:${targetLanguage}:${nativeLanguage}`;
}

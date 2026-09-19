/**
 * Namespaces for recordings that must not reuse the general word cache.
 *
 * The noun article trainer deliberately speaks the bare noun only. Keeping
 * its recordings in a separate namespace prevents a previous recording of a
 * headword with an article (or a sentence-like prompt) from being reused.
 */
export const TTS_CACHE_SCOPES = ["default", "noun-article"] as const;
export type TtsCacheScope = (typeof TTS_CACHE_SCOPES)[number];
export const NOUN_ARTICLE_TTS_CACHE_SCOPE: TtsCacheScope = "noun-article";

export function normalizeTtsCacheScope(value: unknown): TtsCacheScope {
  return value === "noun-article" ? "noun-article" : "default";
}

export const AI_CONFIG = {
  model: "gemini-3.1-flash-lite",
  /**
   * "Обсудить с AI" runs on a stronger model than the rest of the app.
   * Everything else here is extraction — a translation, a word's fields, a
   * grammar table — where the lite model is exactly right. The discussion is
   * the one place that has to reason about what this particular learner needs
   * and write it in plain language, and the lite model answered it with a
   * dictionary gloss.
   *
   * If the key in use cannot reach this model, the route falls back to
   * `model` on the first 404 rather than failing the chat.
   */
  discussModel: process.env.NEXT_PUBLIC_GEMINI_DISCUSS_MODEL || "gemini-3.7-flash",
  /** A discussion answer carries several examples and their translations. */
  discussMaxOutputTokens: 4096,
  maxOutputTokens: 1024,
  temperature: 0.2,
  contextSentences: 1,
} as const;

export const APP_CONFIG = {
  defaultNativeLanguage: "ru",
  defaultTargetLanguage: "de",
  defaultUiLanguage: "ru",
  progressSaveDebounceMs: 2000,
  aiCacheTTLMs: 1000 * 60 * 60 * 24,
} as const;

export const SUPPORTED_LANGUAGES = [
  { code: "ru", nameNative: "Русский", nameEn: "Russian" },
  { code: "en", nameNative: "English", nameEn: "English" },
  { code: "de", nameNative: "Deutsch", nameEn: "German" },
  { code: "es", nameNative: "Español", nameEn: "Spanish" },
  { code: "fr", nameNative: "Français", nameEn: "French" },
] as const;

export const BOOK_FORMATS = [".txt", ".epub", ".fb2"] as const;

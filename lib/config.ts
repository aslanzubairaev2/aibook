export const AI_CONFIG = {
  model: "gemini-3.1-flash-lite",
  /** Structured dictionary and morphology need stronger reasoning than chat/TTS. */
  dictionaryModel: "gemini-3.8-flash",
  dictionaryThinkingLevel: "HIGH",
  /**
   * The discussion is a free conversation (word lists, jokes, corrections), so
   * it runs on the stronger model with a small thinking budget. Probed live on
   * 2026-10-02: ~2-3 s per answer; flash-lite and 3.8 without thinking both
   * followed the request but got word-family facts wrong.
   */
  discussModel: "gemini-3.8-flash",
  discussThinkingBudget: 1024,
  /** A discussion answer carries several examples and their translations; thinking shares this ceiling. */
  discussMaxOutputTokens: 6144,
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

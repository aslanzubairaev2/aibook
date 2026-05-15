export const AI_CONFIG = {
  model: "gemini-3.1-flash-lite",
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

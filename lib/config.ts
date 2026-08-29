export const AI_CONFIG = {
  model: "gemini-3.1-flash-lite",
  /**
   * "Обсудить с AI" — единственное место, которое рассуждает, а не извлекает
   * поля, поэтому оно не идёт на lite-модели вместе со всем остальным.
   *
   * Но и топовая модель здесь не нужна: `gemini-3.7-flash` отвечала заметно
   * медленнее и дороже, а разница в качестве разбора слова для учащегося не
   * окупала ожидания. Обычный flash — компромисс: рассуждать умеет, отвечает
   * быстро.
   *
   * Промпт при этом не менялся — см. `buildDiscussPrompt`.
   *
   * Если ключ не дотягивается до этой модели, маршрут после первой 404
   * переходит на `model`, а не роняет чат. Поэтому опустить обсуждение до
   * самой быстрой модели можно одной переменной окружения:
   * NEXT_PUBLIC_GEMINI_DISCUSS_MODEL=gemini-3.1-flash-lite
   */
  discussModel: process.env.NEXT_PUBLIC_GEMINI_DISCUSS_MODEL || "gemini-3.1-flash",
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

export const AI_CONFIG = {
  model: "gemini-3.1-flash-lite",
  /**
   * "Обсудить с AI" — по явному решению владельца работает на той же
   * lite-модели, что и всё остальное: скорость и стоимость важнее того
   * прироста качества рассуждения, который даёт полноразмерный flash.
   *
   * Промпт при этом не менялся — см. `buildDiscussPrompt`.
   *
   * Понизить/повысить без правки кода можно переменной окружения, например
   * NEXT_PUBLIC_GEMINI_DISCUSS_MODEL=gemini-3.1-flash — маршрут при этом уже
   * умеет падать обратно на `model`, если ключ не дотягивается до заданной.
   */
  discussModel: process.env.NEXT_PUBLIC_GEMINI_DISCUSS_MODEL || "gemini-3.1-flash-lite",
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

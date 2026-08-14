import type { TtsProvider } from "@/lib/types";

const TTS_PROVIDERS = new Set<TtsProvider>([
  "local",
  "gemini",
  "deepgram",
  "speechify",
  "inworld",
  "openai",
  "cartesia",
]);

const LEGACY_TTS_PROVIDERS: Record<string, TtsProvider> = {
  inword: "inworld",
  inwords: "inworld",
  simba: "speechify",
  gpt: "openai",
  gpt4o: "openai",
  "gpt-4o": "openai",
  "gpt_4o": "openai",
  "openai-tts": "openai",
  sonic: "cartesia",
};

export const DEEPGRAM_TTS_SAMPLE_RATE = 24000;

const DEEPGRAM_MODELS: Record<string, string> = {
  de: "aura-2-julius-de",
  en: "aura-2-thalia-en",
  es: "aura-2-celeste-es",
  fr: "aura-2-agathe-fr",
  nl: "aura-2-rhea-nl",
  it: "aura-2-livia-it",
  ja: "aura-2-izanami-ja",
};

export function normalizeLanguageCode(lang: string) {
  return lang.trim().toLowerCase().split(/[-_]/)[0] || lang;
}

export function getDeepgramTtsModel(lang: string) {
  return DEEPGRAM_MODELS[normalizeLanguageCode(lang)] ?? null;
}

export function isDeepgramTtsSupported(lang: string) {
  return Boolean(getDeepgramTtsModel(lang));
}

// ─── Speechify ───────────────────────────────────────────────────────────────
//
// Simba 3.2 tops the quality leaderboards but is English-only: a non-English
// request to it is rejected outright. Simba 3.0 is the streaming-native model
// for the handful of European languages it covers, and Simba Multilingual is
// the catch-all for everything else. Pick by language rather than making the
// learner understand the difference.

const SIMBA_3_LANGUAGES = new Set(["en", "de", "es", "fr", "it", "pt"]);

/** Speechify wants a full locale ("de-DE"), not a bare language code. */
const SPEECHIFY_LOCALES: Record<string, string> = {
  de: "de-DE", en: "en-US", es: "es-ES", fr: "fr-FR", it: "it-IT",
  pt: "pt-BR", ru: "ru-RU", nl: "nl-NL", ja: "ja-JP", pl: "pl-PL",
  tr: "tr-TR", uk: "uk-UA", sv: "sv-SE", da: "da-DK", nb: "nb-NO",
  fi: "fi-FI", cs: "cs-CZ", el: "el-GR", he: "he-IL", hi: "hi-IN",
  ar: "ar-AE", zh: "zh-CN", ko: "ko-KR", vi: "vi-VN", id: "id-ID",
  ro: "ro-RO", hu: "hu-HU", bg: "bg-BG", sk: "sk-SK", hr: "hr-HR",
};

export function getSpeechifyModel(lang: string) {
  return SIMBA_3_LANGUAGES.has(normalizeLanguageCode(lang)) ? "simba-3.0" : "simba-multilingual";
}

/** Widen a bare language code to the BCP-47 tag the voice APIs expect. */
export function getBcp47Locale(lang: string) {
  // A caller that already passed a full locale ("de-AT") knows better than the table.
  if (/^[a-z]{2}-[A-Za-z]{2,4}$/.test(lang.trim())) return lang.trim();
  return SPEECHIFY_LOCALES[normalizeLanguageCode(lang)] ?? null;
}

/** The locale string Speechify expects, or null when we have no mapping. */
export function getSpeechifyLocale(lang: string) {
  return getBcp47Locale(lang);
}

export function isSpeechifyTtsSupported(lang: string) {
  return Boolean(getSpeechifyLocale(lang));
}

// ─── Inworld ─────────────────────────────────────────────────────────────────
//
// inworld-tts-2 takes a BCP-47 language tag and picks the accent from it, so a
// single voice covers every language it was trained on — there is no per-
// language model or voice table to maintain here.

export const INWORLD_MODEL = "inworld-tts-2";

/** Inworld's own sample default; overridable per deployment. */
export const INWORLD_DEFAULT_VOICE = "Matthias";

export function getInworldAuthorizationHeader(apiKey: string) {
  const value = apiKey.trim();
  return /^Basic\s+/i.test(value) ? value : `Basic ${value}`;
}

export function isInworldTtsSupported(lang: string) {
  return Boolean(getBcp47Locale(lang));
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
//
// gpt-4o-mini-tts takes no language field at all: the voice follows the language
// of the text it is handed. So there is no locale table to keep here and no
// per-language question to answer — it speaks whatever the deck holds, which is
// why it is the one voice offered for every language.

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

/** OpenAI's voices are a fixed set of names; this one is the safe default. */
export const OPENAI_DEFAULT_VOICE = "alloy";

/** The voices gpt-4o-mini-tts accepts, for naming a bad GPT_VOICE_ID. */
export const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo",
  "fable", "nova", "onyx", "sage", "shimmer", "verse",
];

/**
 * The voice name in the casing the API accepts.
 *
 * OpenAI's playground lists the voices capitalised — "Ash", "Alloy" — but the
 * API takes only the lowercase form and answers anything else with a 400. The
 * name copied off the screen is the right voice, so fix the casing rather than
 * failing on it. A name that is not a voice at all is passed through untouched,
 * so OpenAI's own message still explains it.
 */
export function normalizeOpenAiVoice(voice: string) {
  const trimmed = voice.trim();
  const lowered = trimmed.toLowerCase();
  return OPENAI_VOICES.includes(lowered) ? lowered : trimmed;
}

export function isOpenAiTtsSupported(_lang: string) {
  return true;
}

// ─── Cartesia ────────────────────────────────────────────────────────────────
//
// Sonic 2 is one multilingual model over a fixed list of languages, and it takes
// the bare two-letter code rather than a locale. The voice, though, is a UUID
// from the account's own library — there is no name to guess at — so it is read
// from the environment, and looked up from the account when unset.

export const CARTESIA_MODEL = "sonic-2";

/** The API version this integration was written against; Cartesia requires it. */
export const CARTESIA_API_VERSION = "2024-11-13";

/** MP3 out of Cartesia is 44.1 kHz; the player is told so by the container. */
export const CARTESIA_SAMPLE_RATE = 44100;

const CARTESIA_LANGUAGES = new Set([
  "en", "fr", "de", "es", "pt", "zh", "ja",
  "hi", "it", "ko", "nl", "pl", "ru", "sv", "tr",
]);

/** The voice to speak with when the deployment names none. */
export const CARTESIA_DEFAULT_VOICE = "Jameson";

/**
 * Whether a configured voice is already the id the API wants.
 *
 * Cartesia addresses voices by UUID, but the library shows them by name, so the
 * value in the environment may be either. A name has to be looked up against
 * the account's voices; a UUID can go straight through.
 */
export function isCartesiaVoiceId(voice: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(voice.trim());
}

export function isCartesiaTtsSupported(lang: string) {
  return CARTESIA_LANGUAGES.has(normalizeLanguageCode(lang));
}

export function normalizeTtsProvider(provider: unknown): TtsProvider {
  if (typeof provider !== "string") return "gemini";

  const normalized = provider.trim().toLowerCase();
  if (TTS_PROVIDERS.has(normalized as TtsProvider)) {
    return normalized as TtsProvider;
  }

  return LEGACY_TTS_PROVIDERS[normalized] ?? "gemini";
}

export function getAvailableTtsProviders(lang: string): TtsProvider[] {
  // Ordered by preference: Gemini leads, then GPT-4o, then Cartesia; the voices
  // that came before them follow in the order they were added.
  const providers: TtsProvider[] = ["local", "gemini"];
  if (isOpenAiTtsSupported(lang)) providers.push("openai");
  if (isCartesiaTtsSupported(lang)) providers.push("cartesia");
  if (isDeepgramTtsSupported(lang)) providers.push("deepgram");
  if (isSpeechifyTtsSupported(lang)) providers.push("speechify");
  if (isInworldTtsSupported(lang)) providers.push("inworld");
  return providers;
}
export function resolveTtsProvider(provider: unknown, lang: string): TtsProvider {
  const normalized = normalizeTtsProvider(provider);
  return getAvailableTtsProviders(lang).includes(normalized) ? normalized : "local";
}

export function getTtsProviderChain(provider: unknown, lang: string): TtsProvider[] {
  const primary = resolveTtsProvider(provider, lang);
  if (primary !== "gemini") return [primary];

  const chain: TtsProvider[] = ["gemini"];
  if (isOpenAiTtsSupported(lang)) chain.push("openai");
  if (isCartesiaTtsSupported(lang)) chain.push("cartesia");
  if (isSpeechifyTtsSupported(lang)) chain.push("speechify");
  if (isInworldTtsSupported(lang)) chain.push("inworld");
  return chain;
}

export function getTtsProviderLabel(provider: TtsProvider) {
  if (provider === "gemini") return "Gemini TTS";
  if (provider === "deepgram") return "Deepgram Aura";
  if (provider === "speechify") return "Speechify Simba";
  if (provider === "inworld") return "Inworld TTS";
  if (provider === "openai") return "OpenAI GPT-4o";
  if (provider === "cartesia") return "Cartesia Sonic";
  return "Локальный";
}

import type { TtsProvider } from "@/lib/types";

const TTS_PROVIDERS = new Set<TtsProvider>([
  "local",
  "gemini",
  "deepgram",
  "speechify",
  "inworld",
  "openai",
  "cartesia",
  "elevenlabs",
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
  eleven: "elevenlabs",
  "11labs": "elevenlabs",
  elevenlab: "elevenlabs",
  // The dashboard variable is spelled ELVENLABS_*; accept that spelling too.
  elvenlabs: "elevenlabs",
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

/**
 * The English name of a language, for engines that take their direction in
 * prose rather than in a locale field.
 *
 * Naming the language is the whole point: an engine left to infer it from the
 * text has only the spelling to go on, and the words a learner drills are the
 * short ones that several languages spell the same way.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", en: "English", es: "Spanish", fr: "French", it: "Italian",
  pt: "Portuguese", ru: "Russian", nl: "Dutch", ja: "Japanese", pl: "Polish",
  tr: "Turkish", uk: "Ukrainian", sv: "Swedish", da: "Danish", nb: "Norwegian",
  fi: "Finnish", cs: "Czech", el: "Greek", he: "Hebrew", hi: "Hindi",
  ar: "Arabic", zh: "Chinese", ko: "Korean", vi: "Vietnamese", id: "Indonesian",
  ro: "Romanian", hu: "Hungarian", bg: "Bulgarian", sk: "Slovak", hr: "Croatian",
};

/** Null for a language we have no name for — better silent than wrong. */
export function getLanguageName(lang: string): string | null {
  return LANGUAGE_NAMES[normalizeLanguageCode(lang)] ?? null;
}

/**
 * Engines whose voice is directed in prose rather than configured in fields.
 *
 * They are the ones a changed instruction changes the output of, so they are
 * the ones whose cached recordings a changed instruction must expire.
 */
export function isPromptDirectedTts(provider: string): boolean {
  return provider === "gemini" || provider === "openai";
}

/**
 * Bumped whenever the direction given to those engines changes.
 *
 * What they say is a function of the instruction as much as of the text, so a
 * rewritten instruction leaves every recording made under the old one stale —
 * and here "stale" means precisely the wrong-language, acted-out readings this
 * was rewritten to stop. It rides in both cache keys, so neither the browser's
 * copy nor the shared one outlives the change that replaced it.
 */
export const SPEECH_STYLE_VERSION = "s2";

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
// gpt-4o-mini-tts takes no language field at all, so there is no locale table to
// keep here — it speaks whatever the deck holds, which is why it is the one
// voice offered for every language. What it does take is direction in plain
// words, and the language is named there instead: left to infer it from the
// text alone, it reads short words into whichever language spells them that way.

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

export const CARTESIA_MODEL = "sonic-3.5";

/**
 * Cartesia's API is dated, and the date is a pinned choice rather than a knob:
 * a newer one can carry breaking changes. This is the version the request shape
 * below was written against.
 */
export const CARTESIA_API_VERSION = "2026-03-01";

/** WAV at 44.1 kHz: self-contained, and the header states the rate we play at. */
export const CARTESIA_SAMPLE_RATE = 44100;

const CARTESIA_LANGUAGES = new Set([
  "en", "fr", "de", "es", "pt", "zh", "ja",
  "hi", "it", "ko", "nl", "pl", "ru", "sv", "tr",
]);

/** Jameson, by id — a real one, since an invented UUID resolves to nothing. */
export const CARTESIA_DEFAULT_VOICE = "a5136bf9-224c-4d76-b823-52bd5efcffcc";

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

// ─── ElevenLabs ──────────────────────────────────────────────────────────────
//
// Multilingual v2 covers the languages this app teaches and is the quality
// model; the flash models trade that away for latency the learner never feels
// on a single card. Voices are addressed by id, and the library shows names, so
// a name is resolved the same way Cartesia's is.

/**
 * Flash 2.5 by default: the cheapest of the models that still covers the
 * languages this app teaches. ELEVENLABS_MODEL_ID overrides it — that variable
 * wins over this constant, which only fills in when it is unset.
 */
export const ELEVENLABS_MODEL = "eleven_flash_v2_5";

/**
 * The models that accept a language_code, and so can be told which language.
 *
 * The rest infer it from the text, and sending the field to one of those is a
 * 400 rather than a hint — so it is sent only where it is understood.
 */
const ELEVENLABS_LANGUAGE_CODE_MODELS = new Set(["eleven_flash_v2_5", "eleven_turbo_v2_5"]);

/** The language code to send with this model, or null when it takes none. */
export function getElevenLabsLanguageCode(model: string, lang: string): string | null {
  if (!ELEVENLABS_LANGUAGE_CODE_MODELS.has(model)) return null;
  return getLanguageName(lang) ? normalizeLanguageCode(lang) : null;
}

/** Roger, by id — see ELEVENLABS_MALE_VOICES for why the id and not the name. */
export const ELEVENLABS_DEFAULT_VOICE = "CwhRBWXzGAHq8TQ4Fs17";

/**
 * The premade male voices, by id.
 *
 * An ElevenLabs key carries granular permissions, and a key scoped to
 * text-to-speech alone cannot read the voice list — asking it to would answer
 * 401 and take the whole engine down with it. These ids are stable and public,
 * so the common case needs no lookup at all; the account's own voices are still
 * fetched on top of this when the key is allowed to see them.
 */
export const ELEVENLABS_MALE_VOICES: TtsVoiceOption[] = [
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", hint: "уверенный" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", hint: "рассказчик" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", hint: "дикторский" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", hint: "глубокий" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", hint: "разговорный" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", hint: "ровный" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", hint: "дружелюбный" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", hint: "молодой" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", hint: "с характером" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", hint: "живой" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", hint: "взрослый" },
];

/** The id for a premade voice name, so a name needs no API call to resolve. */
export function getElevenLabsVoiceIdByName(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return ELEVENLABS_MALE_VOICES.find((voice) => voice.name.toLowerCase() === wanted)?.id ?? null;
}

/**
 * Raw PCM, not MP3.
 *
 * The player's PCM path needs no decoding step at all, while MP3 has to go
 * through the browser's decoder first. 24 kHz is the highest raw rate that is
 * not gated behind a Pro plan, so it is the fast default with MP3 as the
 * fallback for accounts that cannot have it.
 */
export const ELEVENLABS_PCM_FORMAT = "pcm_24000";
export const ELEVENLABS_PCM_SAMPLE_RATE = 24000;
export const ELEVENLABS_MP3_FORMAT = "mp3_44100_128";

/** The 29 languages of multilingual v2. */
const ELEVENLABS_LANGUAGES = new Set([
  "en", "de", "pl", "es", "it", "fr", "pt", "hi", "ar", "zh", "ko", "ja",
  "nl", "tr", "sv", "id", "fil", "uk", "el", "cs", "fi", "ro", "da", "bg",
  "ms", "sk", "hr", "ta", "no", "nb", "vi", "ru", "hu",
]);

export function isElevenLabsTtsSupported(lang: string) {
  return ELEVENLABS_LANGUAGES.has(normalizeLanguageCode(lang));
}

// ─── Choosing a voice ────────────────────────────────────────────────────────
//
// Two of the engines have a fixed cast of voices that ships with the model, and
// two read theirs from the account. The fixed ones live here so the settings
// screen can offer them without a round trip; the others are fetched.

export type TtsVoiceOption = {
  id: string;
  name: string;
  /** How it sounds, in a couple of words, so the choice can be made by ear. */
  hint?: string;
};

/** Gemini's prebuilt cast, the male half of it. */
export const GEMINI_MALE_VOICES: TtsVoiceOption[] = [
  { id: "Algenib", name: "Algenib", hint: "с хрипотцой" },
  { id: "Charon", name: "Charon", hint: "рассказчик" },
  { id: "Puck", name: "Puck", hint: "живой" },
  { id: "Fenrir", name: "Fenrir", hint: "напористый" },
  { id: "Orus", name: "Orus", hint: "твёрдый" },
  { id: "Enceladus", name: "Enceladus", hint: "с придыханием" },
  { id: "Iapetus", name: "Iapetus", hint: "чёткий" },
  { id: "Umbriel", name: "Umbriel", hint: "спокойный" },
  { id: "Algieba", name: "Algieba", hint: "мягкий" },
  { id: "Rasalgethi", name: "Rasalgethi", hint: "лекторский" },
  { id: "Alnilam", name: "Alnilam", hint: "уверенный" },
  { id: "Schedar", name: "Schedar", hint: "ровный" },
  { id: "Gacrux", name: "Gacrux", hint: "взрослый" },
  { id: "Achird", name: "Achird", hint: "дружелюбный" },
  { id: "Zubenelgenubi", name: "Zubenelgenubi", hint: "разговорный" },
  { id: "Sadaltager", name: "Sadaltager", hint: "знающий" },
];

/** OpenAI's cast is fixed and lowercase; these are the male-sounding ones. */
export const OPENAI_MALE_VOICES: TtsVoiceOption[] = [
  { id: "onyx", name: "Onyx", hint: "низкий" },
  { id: "ash", name: "Ash", hint: "собранный" },
  { id: "echo", name: "Echo", hint: "ровный" },
  { id: "ballad", name: "Ballad", hint: "с интонацией" },
  { id: "fable", name: "Fable", hint: "британский" },
  { id: "verse", name: "Verse", hint: "выразительный" },
  { id: "alloy", name: "Alloy", hint: "нейтральный" },
];

/** The voices an engine ships with, or null when they come from the account. */
export function getStaticTtsVoices(provider: TtsProvider): TtsVoiceOption[] | null {
  if (provider === "gemini") return GEMINI_MALE_VOICES;
  if (provider === "openai") return OPENAI_MALE_VOICES;
  return null;
}

/** The engines whose voice the learner may choose. */
export function supportsVoiceChoice(provider: TtsProvider) {
  return provider === "gemini" || provider === "openai"
    || provider === "cartesia" || provider === "elevenlabs";
}

/**
 * A voice name or id is safe to forward upstream.
 *
 * The value arrives from the client, and it is about to be spent against our
 * key, so it is held to the shape every provider's ids and names share rather
 * than passed on as free text.
 */
export function isValidVoiceRef(voice: string) {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(voice.trim());
}

/** The same guard for a model id, which may carry dots but never spaces. */
export function isValidModelRef(model: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(model.trim());
}

/** The Gemini speech model this app was built against. */
export const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

/**
 * The other Gemini speech models, tried when the chosen one runs out of quota.
 *
 * A preview model's free allowance is counted per model, so the second one is
 * a fresh hundred requests rather than the same exhausted bucket — which makes
 * it the right thing to reach for before any of the paid engines. A model id
 * that has since been retired simply 404s and the next one is tried, so a stale
 * entry here costs a round trip and nothing else.
 */
export const GEMINI_TTS_FALLBACK_MODELS = [
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
];

export type TtsModelOption = {
  id: string;
  name: string;
  description?: string;
  /** Relative character cost, when the provider states one. Never guessed. */
  costMultiplier?: number;
  /** Set when the entry does not come from the provider's own listing. */
  unverified?: boolean;
};

/** The engines whose model the learner may choose. */
export function supportsModelChoice(provider: TtsProvider) {
  return provider === "gemini" || provider === "openai"
    || provider === "cartesia" || provider === "elevenlabs";
}

// ─── How the voices should read ──────────────────────────────────────────────
//
// The learner is listening to work out how a word is actually said, so the
// delivery matters as much as the voice: every syllable pronounced, nothing
// swallowed at the start, and slow enough to follow without being a dirge.
// Only some engines take direction; those that do get this.

export function teacherInstructions(lang: string) {
  const language = getLanguageName(lang);
  return [
    "You are a warm, patient language teacher reading aloud for a student.",
    // Without this an engine that reads the language off the text alone will
    // guess, and short words spelled alike across languages — German "so",
    // "was", "die", "hat" — get guessed into English.
    language
      ? `The text is ${language}. Read it as ${language}, with ${language} pronunciation, whatever other language it may resemble.`
      : "Pronounce every word completely and distinctly, in the language of the text.",
    "Read the text exactly as written. Never translate, explain, spell out or add to it.",
    // The engines are answering a dictionary lookup, not performing a scene.
    // Told only to "read a word", they have acted the word out instead: the
    // German "lacht" came back as laughter rather than as the word.
    "Never act out or illustrate what the text means. Produce no laughter, sighs,",
    "gasps, breaths, crying, shouting or any other sound effect, no matter what",
    "the words describe — every word is spoken, never performed.",
    "Never clip, swallow or rush the first syllable of a sentence — begin cleanly.",
    "Keep an even, unhurried pace with clear separation between words,",
    "a short pause at commas and a full one at sentence ends.",
    "Use a calm, even, encouraging tone; do not dramatise or whisper.",
  ].join(" ");
}

/**
 * The prompt Gemini's speech models take: direction, a colon, then the words.
 *
 * Everything ahead of the colon steers the delivery and is not spoken, and
 * everything after it is — which is why the direction is kept to one sentence.
 * A long one starts to read like content, and content is what gets said aloud.
 *
 * Until this existed the model was handed the bare word and told nothing, so it
 * settled both open questions itself: which language a word like "so" is in,
 * and whether "lacht" is a word to pronounce or a laugh to perform.
 */
export function buildGeminiSpeechPrompt(text: string, lang: string) {
  const language = getLanguageName(lang);
  return [
    "Say the following",
    language ? ` in ${language}` : "",
    ", exactly as written, with a calm and neutral teacher's voice,",
    " without acting it out or adding any sound effects: ",
    text,
  ].join("");
}

/** GPT-4o reads a shade slower than a learner wants; nudge it along. */
export const OPENAI_SPEAKING_RATE = 1.1;

export function normalizeTtsProvider(provider: unknown): TtsProvider {
  if (typeof provider !== "string") return "gemini";

  const normalized = provider.trim().toLowerCase();
  if (TTS_PROVIDERS.has(normalized as TtsProvider)) {
    return normalized as TtsProvider;
  }

  return LEGACY_TTS_PROVIDERS[normalized] ?? "gemini";
}

export function getAvailableTtsProviders(lang: string): TtsProvider[] {
  // Ordered by preference: Gemini, GPT-4o, Cartesia, ElevenLabs, then the rest.
  // The browser's own voice goes last — it is the thing to reach for when every
  // real voice has failed, not the first offer.
  const providers: TtsProvider[] = ["gemini"];
  if (isOpenAiTtsSupported(lang)) providers.push("openai");
  if (isCartesiaTtsSupported(lang)) providers.push("cartesia");
  if (isElevenLabsTtsSupported(lang)) providers.push("elevenlabs");
  if (isDeepgramTtsSupported(lang)) providers.push("deepgram");
  if (isSpeechifyTtsSupported(lang)) providers.push("speechify");
  if (isInworldTtsSupported(lang)) providers.push("inworld");
  providers.push("local");
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
  if (isElevenLabsTtsSupported(lang)) chain.push("elevenlabs");
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
  if (provider === "elevenlabs") return "ElevenLabs";
  return "Локальный";
}

// gpt-realtime-translate — OpenAI's dedicated speech-to-speech translation
// session, the direct counterpart to Gemini's live-translate-preview.
//
// Unlike a general chat model, this one takes no system prompt and offers no
// voice choice at all (per OpenAI's own guide: "does not currently support
// custom prompting or voice selection parameters") — it mirrors the speaker's
// tone and can only translate. That is a stronger guarantee against stray
// commentary than any prompt could give a general-purpose model.

export const GPT_TRANSLATE_MODEL = "gpt-realtime-translate";
export const GPT_TRANSLATE_TRANSCRIBE_MODEL = "gpt-realtime-whisper";

/**
 * Flat per-minute audio pricing — not token metered like gpt-realtime-2.
 * Source: OpenAI's realtime voice model pricing (May 2026 announcement).
 * Confirmed live against the actual token-minting endpoint on 2026-08-29.
 */
export const GPT_TRANSLATE_USD_PER_MINUTE = 0.034;

/**
 * The 13 languages gpt-realtime-translate can produce as output audio.
 * Source input side auto-detects across 70+ languages — there is no field to
 * pin or hint it, same limitation as Gemini's translate mode.
 */
export const GPT_TRANSLATE_TARGET_LANGUAGES = [
  "es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it", "en",
] as const;

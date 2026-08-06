// What a whole-text translation or narration will cost, shown before it runs.
//
// Rates below are from https://ai.google.dev/gemini-api/docs/pricing (paid
// tier, standard, USD per 1M tokens). Two of the three models are confirmed
// against that page; the third is marked. Everything else here is arithmetic,
// and the UI shows every figure with "≈" regardless.

export type Rates = {
  currency: string;

  /**
   * gemini-3.1-flash-lite — translation, word analysis, lesson generation.
   *
   * ⚠️ NOT CONFIRMED. Taken from a pricing table whose model heading was cut
   * off in the screenshot it came from. It is the higher of the candidates, so
   * an error here overstates the quote rather than understating it — the safe
   * direction for a spend warning. Verify against the page above.
   */
  textInputPerMTok: number;
  textOutputPerMTok: number;

  /** gemini-3.1-flash-tts-preview — narration. Confirmed. */
  ttsInputPerMTok: number;
  ttsOutputPerMTok: number;

  /** gemini-3.1-flash-live-preview — voice chat. Confirmed, billed per minute. */
  liveAudioInPerMin: number;
  liveAudioOutPerMin: number;
};

export const RATES: Rates = {
  currency: "$",
  textInputPerMTok: 0.25,
  textOutputPerMTok: 1.50,
  ttsInputPerMTok: 1.00,
  ttsOutputPerMTok: 20.00,
  liveAudioInPerMin: 0.005,
  liveAudioOutPerMin: 0.018,
};

/**
 * Speech is billed by duration, not by the length of the text fed in: the
 * pricing page states audio tokens correspond to 25 tokens per second of
 * audio. Estimating narration from characters alone — as this did before —
 * understated it by roughly half.
 */
const AUDIO_TOKENS_PER_SECOND = 25;

/**
 * Characters per token, by script.
 *
 * Latin text runs about four characters to a token; Cyrillic is tokenised far
 * less efficiently, closer to two and a half. Using one number for both would
 * understate the cost of translating into Russian by roughly half — the wrong
 * direction for a figure someone approves a charge against.
 */
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CYRILLIC = 2.5;

export function estimateTokens(text: string): number {
  const cyrillic = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const ratio = cyrillic > text.length / 4 ? CHARS_PER_TOKEN_CYRILLIC : CHARS_PER_TOKEN_LATIN;
  return Math.ceil(text.length / ratio);
}

/**
 * Above this many characters a text is "large": worth stopping to confirm
 * rather than spending silently. Roughly a dozen pages.
 */
export const LARGE_TEXT_CHARS = 20000;

/** Characters of speech per minute of audio, for showing a duration alongside the price. */
const CHARS_PER_MINUTE_SPEECH = 900;

export type CostEstimate = {
  chars: number;
  /**
   * Unrounded. Rounding to cents here would collapse every text under a few
   * hundred thousand characters to the same 0.00 and make the estimates
   * incomparable; formatCost rounds for display instead.
   */
  amount: number;
  currency: string;
  isLarge: boolean;
};

export type AudioCostEstimate = CostEstimate & { minutes: number };

/**
 * Translation bills input and output separately.
 *
 * The output is unknown before it exists, so it is approximated by the source
 * length — a translation is roughly as long as its original, and this errs
 * high for Russian output, which is the safer direction.
 */
export function estimateTranslationCost(text: string): CostEstimate {
  const inputTokens = estimateTokens(text);
  // Cyrillic output from Latin input costs more tokens for the same content.
  const outputTokens = Math.ceil(inputTokens * (CHARS_PER_TOKEN_LATIN / CHARS_PER_TOKEN_CYRILLIC));

  const amount =
    (inputTokens / 1_000_000) * RATES.textInputPerMTok +
    (outputTokens / 1_000_000) * RATES.textOutputPerMTok;

  return {
    chars: text.length,
    amount,
    currency: RATES.currency,
    isLarge: text.length > LARGE_TEXT_CHARS,
  };
}

export function estimateAudioCost(text: string): AudioCostEstimate {
  const seconds = (text.length / CHARS_PER_MINUTE_SPEECH) * 60;
  const audioTokens = seconds * AUDIO_TOKENS_PER_SECOND;

  const amount =
    (estimateTokens(text) / 1_000_000) * RATES.ttsInputPerMTok +
    (audioTokens / 1_000_000) * RATES.ttsOutputPerMTok;

  return {
    chars: text.length,
    amount,
    currency: RATES.currency,
    isLarge: text.length > LARGE_TEXT_CHARS,
    minutes: Math.max(1, Math.round(text.length / CHARS_PER_MINUTE_SPEECH)),
  };
}

/** "≈ $0.42", or "меньше цента" when rounding would show a bare zero. */
export function formatCost(estimate: CostEstimate): string {
  if (estimate.amount < 0.01) return "меньше цента";
  return `≈ ${estimate.currency}${estimate.amount.toFixed(2)}`;
}

/** "18 500 знаков" with thin spaces, for the confirmation sheet. */
export function formatChars(chars: number): string {
  return `${chars.toLocaleString("ru-RU")} знаков`;
}

/**
 * Voice chat, per minute of conversation.
 *
 * Billed by audio minute in each direction, so the figure depends on who is
 * talking. `speakingShare` is the fraction of the minute the model speaks —
 * 0.5 for an even back-and-forth.
 */
export function estimateLiveChatPerMinute(speakingShare = 0.5): number {
  return (
    RATES.liveAudioInPerMin * (1 - speakingShare) +
    RATES.liveAudioOutPerMin * speakingShare
  );
}

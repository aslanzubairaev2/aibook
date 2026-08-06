// What a whole-text translation or narration will cost, shown before it runs.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RATES BELOW ARE NOT VERIFIED. Check them against Google's current
// pricing page before trusting the figures this produces:
//   https://ai.google.dev/gemini-api/docs/pricing
// They are the one place to edit — everything else here is arithmetic. The UI
// always shows the result with a "≈" for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

export type Rates = {
  currency: string;
  /** Per 1,000,000 input tokens. */
  textInputPerMTok: number;
  /** Per 1,000,000 output tokens. */
  textOutputPerMTok: number;
  /** Per 1,000,000 characters sent to text-to-speech. */
  ttsPerMChar: number;
};

export const RATES: Rates = {
  currency: "$",
  textInputPerMTok: 0.10,
  textOutputPerMTok: 0.40,
  ttsPerMChar: 16.0,
};

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
  const amount = (text.length / 1_000_000) * RATES.ttsPerMChar;
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

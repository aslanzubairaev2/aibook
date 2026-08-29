import assert from "node:assert/strict";
import { test } from "node:test";
import { accumulateGptRealtimeUsage } from "./gptRealtimeModels.ts";
import { calculateLiveUsage } from "./liveTranslateState.ts";

test("prices a turn with no cached tokens at the fresh audio/text rates", () => {
  const usage = accumulateGptRealtimeUsage(calculateLiveUsage(), {
    input_tokens: 132,
    output_tokens: 121,
    total_tokens: 253,
    input_token_details: { text_tokens: 119, audio_tokens: 13 },
    output_token_details: { text_tokens: 30, audio_tokens: 91 },
  });
  // (13*32 + 119*4 + 91*64 + 30*24) / 1e6
  assert.equal(usage.estimatedUsd, (13 * 32 + 119 * 4 + 91 * 64 + 30 * 24) / 1_000_000);
  assert.equal(usage.costBasis, "tokens");
});

test("bills the cached portion of input at the discounted rate, not the fresh rate", () => {
  // Same shape as OpenAI's own response.done example: 64 of the 119 text
  // tokens are cached (replayed conversation history), the rest fresh.
  const usage = accumulateGptRealtimeUsage(calculateLiveUsage(), {
    input_tokens: 132,
    output_tokens: 121,
    total_tokens: 253,
    input_token_details: {
      text_tokens: 119,
      audio_tokens: 13,
      cached_tokens: 64,
      cached_tokens_details: { text_tokens: 64, audio_tokens: 0 },
    },
    output_token_details: { text_tokens: 30, audio_tokens: 91 },
  });
  // 55 fresh text (119-64), 13 fresh audio (no cached audio), 64 cached, same output.
  const expected = (13 * 32 + 55 * 4 + 64 * 0.4 + 91 * 64 + 30 * 24) / 1_000_000;
  assert.equal(usage.estimatedUsd, expected);
  // Pricing the full 119 text tokens at the fresh $4/1M rate instead of
  // discounting the 64 cached ones is exactly the regression this guards —
  // it would overstate the turn's cost.
  const overpriced = (13 * 32 + 119 * 4 + 91 * 64 + 30 * 24) / 1_000_000;
  assert.ok(usage.estimatedUsd < overpriced);
});

test("a session-length conversation where later turns replay most of history as cached stays cheap", () => {
  // Turn 10 of a growing conversation: most of the 2000 audio tokens it
  // reprocesses are turns 1-9 being replayed (cached), only a slice is new.
  const usage = accumulateGptRealtimeUsage(calculateLiveUsage(), {
    input_tokens: 2000,
    output_tokens: 100,
    total_tokens: 2100,
    input_token_details: {
      text_tokens: 0,
      audio_tokens: 2000,
      cached_tokens: 1900,
      cached_tokens_details: { text_tokens: 0, audio_tokens: 1900 },
    },
    output_token_details: { text_tokens: 0, audio_tokens: 100 },
  });
  // Without the cache discount this turn alone would cost (2000*32 + 100*64)/1e6 = $0.0704.
  const withoutDiscount = (2000 * 32 + 100 * 64) / 1_000_000;
  assert.ok(usage.estimatedUsd < withoutDiscount / 5, "cached replay must not be billed near the fresh rate");
});

test("accumulates cost across turns", () => {
  const first = accumulateGptRealtimeUsage(calculateLiveUsage(), {
    input_tokens: 10, output_tokens: 5, total_tokens: 15,
    input_token_details: { text_tokens: 0, audio_tokens: 10 },
    output_token_details: { text_tokens: 0, audio_tokens: 5 },
  });
  const second = accumulateGptRealtimeUsage(first, {
    input_tokens: 10, output_tokens: 5, total_tokens: 15,
    input_token_details: { text_tokens: 0, audio_tokens: 10 },
    output_token_details: { text_tokens: 0, audio_tokens: 5 },
  });
  assert.equal(second.estimatedUsd, first.estimatedUsd * 2);
  assert.equal(second.inputTokens, 20);
  assert.equal(second.outputTokens, 10);
});

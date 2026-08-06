// Run with: npm test
//
// These figures are shown to someone about to approve a charge, so the maths
// gets pinned even though the rates behind it are configurable.

import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateAudioCost,
  estimateTokens,
  estimateTranslationCost,
  estimateLiveChatPerMinute,
  formatCost,
  LARGE_TEXT_CHARS,
  RATES,
} from "./costs.ts";

test("Cyrillic is counted as more tokens per character than Latin", () => {
  const latin = "a".repeat(1000);
  const cyrillic = "б".repeat(1000);
  assert.ok(
    estimateTokens(cyrillic) > estimateTokens(latin),
    "understating Cyrillic would halve the quoted price for translating into Russian",
  );
});

test("a mostly-Latin text with a few Cyrillic words still counts as Latin", () => {
  const mixed = "Die Blume steht hier ".repeat(20) + "цветок";
  assert.equal(estimateTokens(mixed), Math.ceil(mixed.length / 4));
});

test("cost grows with length", () => {
  const short = estimateTranslationCost("Die Blume steht hier.");
  const long = estimateTranslationCost("Die Blume steht hier. ".repeat(500));
  assert.ok(long.amount > short.amount);
});

test("the large-text threshold matches the confirmation the user sees", () => {
  assert.equal(estimateTranslationCost("x".repeat(LARGE_TEXT_CHARS - 1)).isLarge, false);
  assert.equal(estimateTranslationCost("x".repeat(LARGE_TEXT_CHARS + 1)).isLarge, true);
});

test("audio reports a duration alongside the price", () => {
  const estimate = estimateAudioCost("x".repeat(9000));
  assert.equal(estimate.minutes, 10);
  assert.ok(estimate.amount > 0);
});

test("audio is never quoted as zero minutes", () => {
  assert.equal(estimateAudioCost("Hallo.").minutes, 1);
});

test("a price too small to round is spelled out, not shown as $0.00", () => {
  assert.equal(formatCost(estimateTranslationCost("Hallo.")), "меньше цента");
  assert.match(formatCost(estimateTranslationCost("x".repeat(4_000_000))), /^≈ \$\d+\.\d\d$/);
});

test("narration is billed by duration, not by text length", () => {
  // 25 audio tokens per second at $20/1M means $0.03 for a minute of speech.
  // Deriving it from characters alone understated it by about half.
  const oneMinute = estimateAudioCost("x".repeat(900));
  assert.equal(oneMinute.minutes, 1);
  assert.ok(
    Math.abs(oneMinute.amount - 0.03) < 0.005,
    `a minute of speech should cost about $0.03, got ${oneMinute.amount.toFixed(4)}`,
  );
});

test("narration costs far more than translating the same text", () => {
  const text = "Die Blume steht am Fenster. ".repeat(1500);
  assert.ok(
    estimateAudioCost(text).amount > estimateTranslationCost(text).amount * 10,
    "audio is the expensive one; a quote that says otherwise is wrong",
  );
});

test("voice chat is quoted per minute of conversation", () => {
  // Between the two per-minute rates, and closer to the model's when it talks more.
  const even = estimateLiveChatPerMinute(0.5);
  assert.ok(even > RATES.liveAudioInPerMin && even < RATES.liveAudioOutPerMin);
  assert.ok(estimateLiveChatPerMinute(0.9) > even);
});

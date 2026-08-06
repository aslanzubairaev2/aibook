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
  formatCost,
  LARGE_TEXT_CHARS,
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

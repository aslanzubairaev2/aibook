// Run with: npm run test:vocab
//
// Coverage matching is pure arithmetic but easy to get subtly wrong — an
// over-eager suffix rule silently claims the learner knows words they do not,
// and nothing in the UI would reveal it. These lock the behaviour down.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnownWordSet,
  buildWordCounts,
  computeCoverage,
  tokenizeWords,
  wordVariants,
// Explicit .ts so the same path resolves under both tsc and `node --experimental-strip-types`.
} from "./vocab.ts";

test("tokenizer keeps letters, drops punctuation and single letters", () => {
  assert.deepEqual(tokenizeWords("Die Blume ist schön, oder?"), ["die", "blume", "ist", "schön", "oder"]);
  assert.deepEqual(tokenizeWords("A B Haus"), ["haus"]);
  assert.deepEqual(tokenizeWords("Sonnen-Blume"), ["sonnen", "blume"]);
});

test("deck entries contribute every word, including phrases", () => {
  const deck = buildKnownWordSet(["die Blume", "guten Morgen"]);
  assert.ok(deck.has("blume"));
  assert.ok(deck.has("morgen"));
});

test("an inflected form in the text finds its deck entry", () => {
  // The whole point: "Blumen" in a text must match a "die Blume" card.
  assert.ok(wordVariants("blumen").includes("blume"));
});

test("umlaut changes are not guessed", () => {
  // "Häuser" → "Haus" needs a real stemmer. Guessing it would mark unknown
  // words as known, which is the failure mode worth avoiding.
  const known = buildKnownWordSet(["Haus"]);
  assert.equal(computeCoverage(buildWordCounts("Häuser"), known)?.ratio, 0);
});

test("coverage counts running words, not distinct ones", () => {
  const text = "Die Blume steht am Fenster. Die Blumen sind schön. Wir gehen zum Markt.";
  const stats = buildWordCounts(text);
  assert.equal(stats.tokenTotal, 13);
  assert.equal(stats.wordCounts["die"], 2);

  // Known: die×2, Blume, Blumen, gehen = 5 of 13.
  const coverage = computeCoverage(stats, buildKnownWordSet(["die Blume", "gehen", "guten Morgen"]));
  assert.equal(Math.round(coverage!.ratio * 1000) / 1000, 0.385);
  assert.equal(coverage!.unknownTokens, 8);
});

test("a text made only of known words is fully covered", () => {
  const text = "Die Blume steht am Fenster.";
  const coverage = computeCoverage(buildWordCounts(text), buildKnownWordSet(tokenizeWords(text)));
  assert.equal(coverage!.ratio, 1);
});

test("the comfort band excludes both extremes", () => {
  const words = Array.from({ length: 100 }, (_, i) => (i < 92 ? `bekannt${i % 5}` : `fremd${i}`));
  const inBand = computeCoverage(
    buildWordCounts(words.join(" ")),
    buildKnownWordSet(["bekannt0 bekannt1 bekannt2 bekannt3 bekannt4"]),
  );
  assert.equal(inBand!.isComfortable, true);

  // Nothing new left to learn is not "comfortable", it is finished.
  const allKnown = computeCoverage(buildWordCounts("eins zwei drei"), buildKnownWordSet(["eins zwei drei"]));
  assert.equal(allKnown!.isComfortable, false);
});

test("missing frequency data reads as unknown, not as zero coverage", () => {
  // A text imported before this feature existed must not claim the learner
  // knows none of it.
  assert.equal(computeCoverage({ wordCounts: null, tokenTotal: null }, new Set()), null);
  assert.equal(computeCoverage(null, new Set()), null);
});

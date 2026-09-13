import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWordContextCacheKey } from "./cacheKeys.ts";

test("word analysis cache separates occurrences with different sentence context", () => {
  const first = makeWordContextCacheKey(
    "kauft",
    "Er kauft im Supermarkt ein.",
    "",
    "Sie wartet draußen.",
    "de",
    "ru",
  );
  const second = makeWordContextCacheKey(
    "kauft",
    "Er kauft das Buch.",
    "",
    "Sie wartet draußen.",
    "de",
    "ru",
  );

  assert.notEqual(first, second);
  assert.match(first, /^v3:word-context:/);
});

test("word analysis cache remains stable for whitespace and case differences", () => {
  const first = makeWordContextCacheKey(" KAUFT ", "Er  kauft ein.", "", "", "de", "ru");
  const second = makeWordContextCacheKey("kauft", "er kauft ein.", "", "", "de", "ru");

  assert.equal(first, second);
});

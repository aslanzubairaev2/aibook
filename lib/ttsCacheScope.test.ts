import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTtsCacheScope } from "./ttsCacheScope.ts";

test("noun article audio has its own cache namespace", () => {
  assert.equal(normalizeTtsCacheScope("noun-article"), "noun-article");
  assert.equal(normalizeTtsCacheScope("default"), "default");
  assert.equal(normalizeTtsCacheScope("unexpected"), "default");
});

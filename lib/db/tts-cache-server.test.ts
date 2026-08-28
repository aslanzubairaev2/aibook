import test from "node:test";
import assert from "node:assert/strict";
import { cacheVoiceNameCandidates } from "./tts-cache-server.ts";

test("server cache checks the current key before the migrated legacy key", () => {
  assert.deepEqual(
    cacheVoiceNameCandidates("Algenib:s2", ["Algenib", "Algenib:s2"]),
    ["Algenib:s2", "Algenib"],
  );
});

test("server cache does not duplicate empty legacy candidates", () => {
  assert.deepEqual(cacheVoiceNameCandidates("current", ["", "current", "legacy"]), ["current", "legacy"]);
});

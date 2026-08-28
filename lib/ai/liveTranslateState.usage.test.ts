import assert from "node:assert/strict";
import { test } from "node:test";
import { accumulateLiveUsage, calculateLiveUsage } from "./liveTranslateState.ts";

test("calculates separate input/output cost from cumulative usage metadata", () => {
  const usage = calculateLiveUsage({ promptTokenCount: 1_000_000, responseTokenCount: 100_000, totalTokenCount: 1_100_000, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1_000_000 }], responseTokensDetails: [{ modality: "AUDIO", tokenCount: 100_000 }] });
  assert.equal(usage.inputTokens, 1_000_000);
  assert.equal(usage.outputTokens, 100_000);
  assert.equal(usage.totalTokens, 1_100_000);
  assert.equal(usage.estimatedUsd, 5.6);
  assert.equal(usage.detailUnavailable, false);
});

test("handles missing metadata and marks modality detail unavailable", () => {
  const usage = calculateLiveUsage({ totalTokenCount: 12 });
  assert.deepEqual(usage, { inputTokens: 0, outputTokens: 0, totalTokens: 12, estimatedUsd: 0, detailUnavailable: true });
});

test("accumulates usage across server messages", () => {
  const first = calculateLiveUsage({ promptTokenCount: 10, responseTokenCount: 2, totalTokenCount: 12, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }], responseTokensDetails: [{ modality: "AUDIO", tokenCount: 2 }] });
  const total = accumulateLiveUsage(first, { promptTokenCount: 5, responseTokenCount: 3, totalTokenCount: 8, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 5 }], responseTokensDetails: [{ modality: "AUDIO", tokenCount: 3 }] });
  assert.deepEqual(total, { inputTokens: 15, outputTokens: 5, totalTokens: 20, estimatedUsd: 0.0001575, detailUnavailable: false });
});

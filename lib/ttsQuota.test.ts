import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseQuotaError, quotaMessageRu } from "./ttsQuota.ts";

const perDayFreeTier = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaValue: "15",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "32s" },
    ],
  },
});

test("names the per-day free-tier quota, its ceiling and the retry hint", () => {
  const d = diagnoseQuotaError(perDayFreeTier);
  assert.equal(d.window, "day");
  assert.equal(d.freeTier, true);
  assert.equal(d.limit, "15");
  assert.equal(d.retryAfterSeconds, 32);
  assert.equal(d.quotaId, "GenerateRequestsPerDayPerProjectPerModel-FreeTier");
});

test("distinguishes a per-minute limit from a spent day", () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "10" }],
        },
      ],
    },
  });
  const d = diagnoseQuotaError(body);
  assert.equal(d.window, "minute");
  assert.equal(d.freeTier, false);
  assert.equal(d.limit, "10");
});

test("a spent day outranks a per-minute violation in the same response", () => {
  const body = JSON.stringify({
    error: {
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            { quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "10" },
            { quotaId: "GenerateRequestsPerDayPerProjectPerModel", quotaValue: "100" },
          ],
        },
      ],
    },
  });
  // Waiting a minute fixes one of these and not the other, so the message has
  // to be about the one that will not clear.
  assert.equal(diagnoseQuotaError(body).window, "day");
  assert.equal(diagnoseQuotaError(body).limit, "100");
});

test("survives a body that is not the JSON we expect", () => {
  const html = diagnoseQuotaError("<html>429 Too Many Requests</html>");
  assert.equal(html.window, "unknown");
  assert.equal(html.freeTier, false);
  assert.equal(html.retryAfterSeconds, null);
  assert.match(html.message ?? "", /429/);

  const empty = diagnoseQuotaError("");
  assert.equal(empty.window, "unknown");
  assert.equal(empty.message, null);
});

test("the free-tier day message points at billing, not at waiting", () => {
  const message = quotaMessageRu(diagnoseQuotaError(perDayFreeTier));
  assert.match(message, /бесплатн/i);
  assert.match(message, /биллинг/i);
  assert.match(message, /15/);
});

// The MCP token is the only thing standing between the public internet and one
// user's flashcards, so its failure modes are worth pinning down: a forged or
// tampered token must never resolve to a user id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintMcpToken, verifyMcpToken } from "./token.ts";

const SECRET = "test-secret-not-for-production";
const USER_ID = "3f2a1b6c-9d8e-4f70-a1b2-c3d4e5f60718";

test("a minted token verifies back to the same user id", () => {
  const token = mintMcpToken(USER_ID, SECRET);
  assert.ok(token, "token should be minted when a secret exists");
  assert.equal(verifyMcpToken(token!, SECRET), USER_ID);
});

test("minting is deterministic — same user, same token", () => {
  assert.equal(mintMcpToken(USER_ID, SECRET), mintMcpToken(USER_ID, SECRET));
});

test("the token survives a URL round trip", () => {
  const token = mintMcpToken(USER_ID, SECRET)!;
  // Path segments get percent-encoded by clients; the route decodes before verifying.
  assert.equal(verifyMcpToken(decodeURIComponent(encodeURIComponent(token)), SECRET), USER_ID);
});

test("tampering with the embedded user id invalidates the token", () => {
  const token = mintMcpToken(USER_ID, SECRET)!;
  const [prefix, , sig] = token.split(".");
  const otherId = Buffer.from("11111111-2222-3333-4444-555555555555").toString("base64url");
  assert.equal(verifyMcpToken(`${prefix}.${otherId}.${sig}`, SECRET), null);
});

test("tampering with the signature invalidates the token", () => {
  const token = mintMcpToken(USER_ID, SECRET)!;
  const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(verifyMcpToken(flipped, SECRET), null);
});

test("a token minted under one secret fails under another", () => {
  const token = mintMcpToken(USER_ID, "old-secret")!;
  assert.equal(verifyMcpToken(token, "new-secret"), null, "rotating the secret revokes all tokens");
});

test("garbage inputs return null instead of throwing", () => {
  for (const bad of ["", "aib1", "aib1.x", "not.a.token", "aib1..", "aib1.%%%.###"]) {
    assert.equal(verifyMcpToken(bad, SECRET), null, `should reject: ${bad}`);
  }
});

test("no secret configured means nothing mints and nothing verifies", () => {
  assert.equal(mintMcpToken(USER_ID, null), null);
  assert.equal(verifyMcpToken(mintMcpToken(USER_ID, SECRET)!, null), null);
});

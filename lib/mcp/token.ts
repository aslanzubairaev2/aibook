// Personal tokens for the MCP endpoint.
//
// External agents (ChatGPT, Claude, Gemini CLI…) cannot go through the app's
// Supabase login, so they authenticate with a long-lived token embedded in the
// endpoint URL: /api/mcp/<token>. Nothing is stored server-side — the token is
// an HMAC over the user id, and verification just recomputes the signature.
// Changing MCP_TOKEN_SECRET (or the service-role key it falls back to)
// invalidates every issued token at once, which is the revocation story.
//
// Format: aib1.<base64url(userId)>.<base64url(hmac-sha256)>
// Dots as separators because base64url itself may contain "-" and "_".

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "aib1";

function defaultSecret(): string | null {
  return process.env.MCP_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}:${userId}`).digest("base64url");
}

/** Issue the personal MCP token for a verified user. Null when no secret is configured. */
export function mintMcpToken(userId: string, secret: string | null = defaultSecret()): string | null {
  if (!secret || !userId) return null;
  return `${PREFIX}.${Buffer.from(userId, "utf8").toString("base64url")}.${sign(userId, secret)}`;
}

/** Return the user id a token was issued for, or null when it is invalid. */
export function verifyMcpToken(token: string, secret: string | null = defaultSecret()): string | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;

  let userId: string;
  try {
    userId = Buffer.from(parts[1], "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!userId) return null;

  const expected = Buffer.from(sign(userId, secret), "utf8");
  const given = Buffer.from(parts[2], "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}

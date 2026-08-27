import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// One client, not one per call: createClient() per request meant every route
// paid setup cost and threw away any HTTP keep-alive to Supabase's auth server.
const supabaseServer = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const ownerUserIds = (process.env.AI_OWNER_USER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const ownerEmails = (process.env.AI_OWNER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// auth.getUser() is a network round trip to Supabase's auth server, and a
// single screen fires several of these API routes back to back with the same
// token (e.g. the lessons list + its progress, then the chapters call when a
// lesson is opened). Paying that round trip separately for each one was the
// dominant cost behind slow tab switches and slow opens. Caching the verified
// user for a short window means a burst of calls on the same token pays it
// once; a revoked token can still be trusted for up to this long, which is an
// acceptable trade for a personal-learning app.
const TOKEN_CACHE_TTL_MS = 60_000;
const userCache = new Map<string, { user: User; expiresAt: number }>();

function cacheUser(token: string, user: User) {
  // Opportunistic cleanup so the map doesn't grow unbounded across a long-lived
  // server instance — cheap since it only runs when we're about to add an entry.
  if (userCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of userCache) {
      if (entry.expiresAt <= now) userCache.delete(key);
    }
  }
  userCache.set(token, { user, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
}

/**
 * Verify the Supabase JWT from the Authorization header and return the user.
 * Returns null when the header is missing/invalid — never trust client-supplied
 * user ids in query params or request bodies; derive identity from this instead.
 */
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ") || !supabaseServer) {
    return null;
  }
  const token = authHeader.substring(7);

  const cached = userCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (error || !user) {
      userCache.delete(token);
      return null;
    }
    cacheUser(token, user);
    return user;
  } catch (e) {
    console.error("getUserFromRequest: token verification failed:", e);
    return null;
  }
}

/** True when the verified user is in the owner allowlist (AI_OWNER_USER_IDS / AI_OWNER_EMAILS). */
export function isOwnerUser(user: User): boolean {
  const email = user.email?.trim().toLowerCase() || "";
  return ownerUserIds.includes(user.id) || (email !== "" && ownerEmails.includes(email));
}

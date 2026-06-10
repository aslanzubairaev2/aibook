import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const ownerUserIds = (process.env.AI_OWNER_USER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const ownerEmails = (process.env.AI_OWNER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

/**
 * Verify the Supabase JWT from the Authorization header and return the user.
 * Returns null when the header is missing/invalid — never trust client-supplied
 * user ids in query params or request bodies; derive identity from this instead.
 */
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    const supabaseServer = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (error || !user) return null;
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

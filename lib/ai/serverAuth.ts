import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const ownerUserIds = (process.env.AI_OWNER_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const ownerEmails = (process.env.AI_OWNER_EMAILS || "")
  .split(",")
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export async function getApiKeyForRequest(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") || "";
  const clientKey = req.headers.get("x-gemini-key") || "";

  let isAllowed = false;

  if (authHeader.startsWith("Bearer ") && supabaseUrl && supabaseAnonKey) {
    const token = authHeader.substring(7);
    try {
      const supabaseServer = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (user && !error) {
        const userId = user.id;
        const userEmail = user.email?.trim().toLowerCase() || "";

        const isOwnerId = ownerUserIds.includes(userId);
        const isOwnerEmail = ownerEmails.includes(userEmail);

        if (isOwnerId || isOwnerEmail) {
          isAllowed = true;
        }
      }
    } catch (e) {
      console.error("Error verifying Supabase token in API route:", e);
    }
  }

  // If in allowlist, use server-side GEMINI_API_KEY
  if (isAllowed && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // If not in allowlist, use the client-supplied Gemini key
  if (clientKey) {
    return clientKey;
  }

  // Otherwise, deny access
  throw new Error("Access Denied: AI is only available to owners or users who have set their own Gemini API key in Settings.");
}

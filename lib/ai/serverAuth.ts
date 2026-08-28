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

export async function isOwnerRequest(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !supabaseAnonKey) return false;

  const token = authHeader.substring(7);
  try {
    const supabaseServer = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (!user || error) return false;

    const userId = user.id;
    const userEmail = user.email?.trim().toLowerCase() || "";

    return ownerUserIds.includes(userId) || ownerEmails.includes(userEmail);
  } catch (e) {
    console.error("Error verifying Supabase token in API route:", e);
    return false;
  }
}

export async function getApiKeyForRequest(req: Request): Promise<string> {
  const clientKey = req.headers.get("x-gemini-key") || "";
  const isAllowed = await isOwnerRequest(req);

  // Explicit local-only convenience for testing the app in a browser with
  // the server key. This can never affect production access.
  if (process.env.NODE_ENV !== "production" && process.env.AI_ALLOW_DEV_AI === "true" && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // If in allowlist, use server-side GEMINI_API_KEY
  if (isAllowed && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // In development mode, allow server GEMINI_API_KEY if present
  if (process.env.NODE_ENV === "development" && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // If not in allowlist, use the client-supplied Gemini key
  if (clientKey) {
    return clientKey;
  }

  // Otherwise, deny access
  throw new Error("Для распознавания речи требуется Gemini API ключ. Укажите его в Настройках или в поле ввода ниже.");
}

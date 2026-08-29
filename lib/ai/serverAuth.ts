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

/**
 * The OpenAI key for GPT Live Translate.
 *
 * Owner-only, no bring-your-own-key path — the same posture the app already
 * takes for OpenAI's TTS voice (GPT_API_KEY is a server secret there too;
 * see app/api/tts/route.ts). GPT_VOICE_ID's env carries GPT_API_KEY /
 * OPENAI_API_KEY as the two accepted names, so this checks both.
 */
export async function getOpenAiApiKeyForRequest(req: Request): Promise<string> {
  const isAllowed = await isOwnerRequest(req);
  const key = (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (isAllowed && key) return key;
  throw new Error("Access Denied: GPT Live Translate is only available to owners.");
}

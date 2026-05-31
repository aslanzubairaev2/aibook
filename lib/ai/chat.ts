import { supabase } from "@/lib/db/supabase";
import { getLocalGeminiKey, getLocalAiProvider } from "@/lib/db/local";

async function getAiHeaders() {
  const provider = getLocalAiProvider();
  if (provider === "off") {
    throw new Error("AI выключен в настройках. Включите его, чтобы использовать эту функцию.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const localKey = getLocalGeminiKey();
  if (localKey) {
    headers["x-gemini-key"] = localKey;
  }
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }
  return headers;
}

export async function aiChat(prompt: string): Promise<string> {
  const headers = await getAiHeaders();
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "AI chat failed");
  }

  const data = await res.json();
  return data.reply;
}

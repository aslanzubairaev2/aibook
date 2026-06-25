// Short-lived, server-proxied AI helpers for the Live Chat "discuss this text"
// flow: scenario suggestions, on-demand translation, and quick-reply
// suggestions. Unlike LiveChatSession (a persistent browser-to-Google
// WebSocket), these are one-shot requests proxied through our own API routes
// the same way lib/ai/discuss.ts is, so they reuse the owner/local-key auth.

import { supabase } from "@/lib/db/supabase";
import { getLocalGeminiKey, getLocalAiProvider } from "@/lib/db/local";

export type LiveScenario = {
  id: string;
  label: string;
  aiRole: string;
  userRole: string;
  prompt: string;
};

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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAiHeaders();
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || `Request to ${path} failed`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLiveScenarios(text: string, nativeLanguage: string, targetLanguage: string): Promise<LiveScenario[]> {
  const data = await postJson<{ scenarios: LiveScenario[] }>("/api/ai/live-scenarios", { text, nativeLanguage, targetLanguage });
  return data.scenarios;
}

export async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
  const data = await postJson<{ translation: string }>("/api/ai/translate", { text, sourceLanguage, targetLanguage });
  return data.translation;
}

export type LiveSuggestion = { text: string; translation: string };

export async function fetchLiveSuggestions(
  lastModelLine: string,
  nativeLanguage: string,
  targetLanguage: string,
  scenarioContext?: string
): Promise<LiveSuggestion[]> {
  const data = await postJson<{ suggestions: LiveSuggestion[] }>("/api/ai/live-suggestions", {
    lastModelLine,
    nativeLanguage,
    targetLanguage,
    scenarioContext,
  });
  return data.suggestions;
}

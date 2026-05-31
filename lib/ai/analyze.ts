import type { AiAnalysis, AiMode } from "@/lib/types";
import { supabase } from "@/lib/db/supabase";
import { getLocalGeminiKey, getLocalAiProvider } from "@/lib/db/local";

interface AnalyzeParams {
  mode: AiMode;
  word: string;
  text?: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
  skipWord?: boolean;
  skipSentence?: boolean;
}

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

export async function analyzeSelection(params: AnalyzeParams): Promise<AiAnalysis> {
  const headers = await getAiHeaders();
  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "AI analysis failed");
  }

  return res.json() as Promise<AiAnalysis>;
}

export async function analyzeSentence(params: AnalyzeParams): Promise<{
  sentence: {
    text: string;
    translation: string;
    grammarNote: string;
    structure: string;
  };
}> {
  const headers = await getAiHeaders();
  const res = await fetch("/api/ai/analyze-sentence", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "AI sentence analysis failed");
  }

  return res.json();
}

export async function checkServerAiAccess(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }
  
  try {
    const res = await fetch("/api/ai/status", {
      method: "GET",
      headers,
    });
    if (!res.ok) return false;
    const data = await res.json() as { hasServerAccess: boolean };
    return data.hasServerAccess;
  } catch {
    return false;
  }
}


import type { AiMode, DiscussMessage, DiscussWordProfile } from "@/lib/types";
import { supabase } from "@/lib/db/supabase";
import { getLocalGeminiKey, getLocalAiProvider } from "@/lib/db/local";

export type DiscussRequest = {
  mode: AiMode;
  selectedText: string;
  sentence: string;
  sentenceBefore?: string;
  sentenceAfter?: string;
  nativeLanguage: string;
  targetLanguage: string;
  /** CEFR estimate from the learner's own books and deck, when it can be made. */
  learnerLevel?: string;
  /** How well this learner already knows this item, from its card's schedule. */
  wordProfile?: DiscussWordProfile;
  /** mode "homework" only: the exercise being discussed, blanks and all. */
  homeworkContext?: { instruction: string; items: string[] };
  history: DiscussMessage[];
  message: string;
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

export async function discussWithAi(request: DiscussRequest): Promise<DiscussMessage> {
  const headers = await getAiHeaders();
  const res = await fetch("/api/ai/discuss", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "AI discussion failed");
  }

  return res.json() as Promise<DiscussMessage>;
}

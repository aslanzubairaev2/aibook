import { supabase } from "@/lib/db/supabase";
import { getLocalAiProvider, getLocalGeminiKey } from "@/lib/db/local";
import { AI_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/net/freshFetch";
import type {
  VerbPhraseTutorChallenge,
  VerbPhraseTutorMessage,
  VerbPhraseTutorRequest,
} from "@/lib/ai/buildVerbPhraseTutorPrompt";

export type VerbPhraseTutorCorrection = {
  target: string;
  translation: string;
  explanation: string;
};

export type VerbPhraseTutorReply = {
  status: "prompt" | "retry" | "question" | "accepted";
  reply: string;
  hint?: string;
  correction?: VerbPhraseTutorCorrection;
  challenge?: VerbPhraseTutorChallenge;
  suggestions?: string[];
};

export type VerbPhraseTutorCall = Omit<VerbPhraseTutorRequest, "action"> & {
  action: VerbPhraseTutorRequest["action"];
  signal?: AbortSignal;
};

export async function fetchVerbPhraseTutor(request: VerbPhraseTutorCall): Promise<VerbPhraseTutorReply> {
  const provider = getLocalAiProvider();
  if (provider === "off") {
    throw new Error("ИИ выключен в настройках. Включите его, чтобы тренировать фразы.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const localKey = getLocalGeminiKey();
  if (localKey) headers["x-gemini-key"] = localKey;
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = "Bearer " + session.access_token;
  }

  const { signal, ...requestBody } = request;
  const response = await fetchWithTimeout("/api/ai/verb-phrase-tutor", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
  }, AI_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    let error = "";
    try {
      const data = await response.json() as { error?: string };
      error = data.error ?? "";
    } catch {
      error = await response.text();
    }
    throw new Error(error || "Не удалось связаться с репетитором.");
  }

  return response.json() as Promise<VerbPhraseTutorReply>;
}

export type { VerbPhraseTutorChallenge, VerbPhraseTutorMessage };

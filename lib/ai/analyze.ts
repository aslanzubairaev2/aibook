import type { AiAnalysis } from "@/lib/types";

interface AnalyzeParams {
  word: string;
  sentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
  nativeLanguage: string;
  targetLanguage: string;
}

export async function analyzeSelection(params: AnalyzeParams): Promise<AiAnalysis> {
  const storedKey = typeof window !== "undefined" ? localStorage.getItem("aibook_api_key") ?? "" : "";

  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(storedKey ? { "x-gemini-key": storedKey } : {}),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "AI analysis failed");
  }

  return res.json() as Promise<AiAnalysis>;
}

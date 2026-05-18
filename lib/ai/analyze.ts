import type { AiAnalysis, AiMode } from "@/lib/types";

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

export async function analyzeSelection(params: AnalyzeParams): Promise<AiAnalysis> {
  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
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
  const res = await fetch("/api/ai/analyze-sentence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "AI sentence analysis failed");
  }

  return res.json();
}

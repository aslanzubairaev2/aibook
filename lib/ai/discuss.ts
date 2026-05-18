import type { AiMode, DiscussMessage } from "@/lib/types";

export type DiscussRequest = {
  mode: AiMode;
  selectedText: string;
  sentence: string;
  sentenceBefore?: string;
  sentenceAfter?: string;
  nativeLanguage: string;
  targetLanguage: string;
  history: DiscussMessage[];
  message: string;
};

export async function discussWithAi(request: DiscussRequest): Promise<DiscussMessage> {
  const res = await fetch("/api/ai/discuss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "AI discussion failed");
  }

  return res.json() as Promise<DiscussMessage>;
}

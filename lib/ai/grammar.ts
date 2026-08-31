import type { GrammarTable, PosTag } from "@/lib/types";
import { getAiHeaders } from "@/lib/ai/analyze";
import { AI_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/net/freshFetch";

export interface FetchGrammarParams {
  word: string;
  lemma?: string;
  posTag?: PosTag;
  targetLanguage: string;
  nativeLanguage: string;
  detail: "brief" | "full";
  contextSentence?: string;
}

export async function fetchGrammar(params: FetchGrammarParams): Promise<GrammarTable> {
  const headers = await getAiHeaders();
  const res = await fetchWithTimeout("/api/ai/grammar", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  }, AI_REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "Grammar request failed");
  }

  return res.json() as Promise<GrammarTable>;
}

import { getAiHeaders } from "@/lib/ai/analyze";
import type { VerbPhrasePromptParams } from "@/lib/ai/buildVerbPhrasePrompt";
import { fetchWithTimeout } from "@/lib/net/freshFetch";

export async function fetchVerbPhrase(params: VerbPhrasePromptParams): Promise<{ example: string; exampleTranslation: string }> {
  const headers = await getAiHeaders();
  const res = await fetchWithTimeout("/api/ai/verb-phrase", {
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
    throw new Error(err || "Verb phrase request failed");
  }

  return res.json();
}

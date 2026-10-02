import { AI_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/net/freshFetch";
import { getAiHeaders } from "@/lib/ai/analyze";
import type { CardVerifyRequest, CardVerifyResult } from "@/lib/ai/cardVerify";

/** Asks the model to check one card; resolves with its verdict or throws a readable message. */
export async function verifyCard(request: CardVerifyRequest, signal?: AbortSignal): Promise<CardVerifyResult> {
  const headers = await getAiHeaders();
  const res = await fetchWithTimeout("/api/ai/verify-card", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  }, AI_REQUEST_TIMEOUT_MS);

  const data = await res.json().catch(() => null) as (CardVerifyResult & { error?: string }) | null;
  if (!res.ok || !data || "error" in data && data.error) {
    throw new Error((data && "error" in data && data.error) || "Не удалось проверить карточку.");
  }
  return data;
}

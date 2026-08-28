import { getAiHeaders } from "@/lib/ai/chat";

export type AudiobookOverviewResult = { review: string; fromCache: boolean };

/**
 * Fetches the compact AI overview card for an audiobook.
 *
 * Cached server-side by `audiobookId` (see /api/ai/audiobook-overview), so
 * only the very first request for a given book ever reaches Gemini — every
 * later open, on any device, reads the cached row for free.
 */
export async function fetchAudiobookOverview(
  audiobookId: string,
  title: string,
  author: string,
  language: string,
): Promise<AudiobookOverviewResult> {
  const headers = await getAiHeaders();
  const res = await fetch("/api/ai/audiobook-overview", {
    method: "POST",
    headers,
    body: JSON.stringify({ audiobookId, title, author, language }),
  });

  if (!res.ok) {
    let err = "";
    try {
      const parsed = await res.json();
      err = parsed.error || "";
    } catch {
      err = await res.text();
    }
    throw new Error(err || "Audiobook overview failed");
  }

  return res.json() as Promise<AudiobookOverviewResult>;
}

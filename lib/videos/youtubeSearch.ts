export type YouTubeSearchResult = {
  id: string;
  youtubeId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnailUrl: string;
  description: string;
  language: "de" | "en";
};

export async function searchYouTube(
  query: string,
  lang: "de" | "en" = "de",
  limit = 8
): Promise<YouTubeSearchResult[]> {
  try {
    const searchTerms =
      lang === "de" ? `${query} deutsch lernen` : `${query} learn english`;

    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerms)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language":
            lang === "de" ? "de-DE,de;q=0.9,en;q=0.8" : "en-US,en;q=0.9",
        },
        redirect: "follow",
      }
    );

    if (!res.ok) return [];
    const html = await res.text();

    const match =
      html.match(/var ytInitialData = ({.+?});<\/script>/s) ||
      html.match(/window\["ytInitialData"\] = ({.+?});<\/script>/s);
    if (!match || !match[1]) return [];

    const data = JSON.parse(match[1]);
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents ?? [];

    const candidates: YouTubeSearchResult[] = [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;

        const videoId = v.videoId;
        const title =
          v.title?.runs?.map((r: { text: string }) => r.text).join("") || "";
        const channel =
          v.ownerText?.runs?.[0]?.text ||
          v.shortBylineText?.runs?.[0]?.text ||
          "YouTube";
        const duration = v.lengthText?.simpleText || "0:00";
        const desc =
          v.detailedMetadataSnippets?.[0]?.snippetText?.runs
            ?.map((r: { text: string }) => r.text)
            .join("") ||
          v.descriptionSnippet?.runs?.map((r: { text: string }) => r.text).join("") ||
          "";

        // Prefer reliable mqdefault thumbnail
        const thumbUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        if (title && videoId && duration !== "0:00") {
          candidates.push({
            id: `yt-${videoId}`,
            youtubeId: videoId,
            title,
            channel,
            duration,
            thumbnailUrl: thumbUrl,
            description: desc,
            language: lang,
          });
        }

        if (candidates.length >= limit * 2) break;
      }
      if (candidates.length >= limit * 2) break;
    }

    // Verify embedding availability with YouTube oEmbed in parallel
    const verified = await Promise.all(
      candidates.slice(0, limit + 4).map(async (candidate) => {
        try {
          const check = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${candidate.youtubeId}&format=json`
          );
          if (check.ok) {
            return candidate;
          }
          return null;
        } catch {
          return candidate; // Fallback to candidate if network check times out
        }
      })
    );

    return verified.filter((v): v is YouTubeSearchResult => v !== null).slice(0, limit);
  } catch (err) {
    console.error("searchYouTube error:", err);
    return [];
  }
}

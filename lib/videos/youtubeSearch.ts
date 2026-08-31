import { readTranscriptCache } from "./transcriptCacheServer";
import { hasOfficialYouTubeApi, searchYouTubeOfficial } from "./youtubeDataApi";
import type { VideoCategory, VideoCefrLevel, VideoDurationFilter, VideoItem } from "./types";

type SearchOptions = {
  page?: number;
  limit?: number;
  cefrLevel?: VideoCefrLevel;
  category?: VideoCategory;
  duration?: VideoDurationFilter;
  captionsOnly?: boolean;
};

export type YouTubeSearchPage = {
  videos: VideoItem[];
  hasMore: boolean;
  networkAvailable: boolean;
};

type Candidate = Pick<VideoItem, "id" | "youtubeId" | "title" | "channel" | "duration" | "thumbnailUrl" | "description" | "language">;

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; value: YouTubeSearchPage }>();
const DEFAULT_SEARCH_TOPICS: Record<"de" | "en", string[]> = {
  de: [
    "Deutsch lernen mit Untertiteln",
    "Deutsch A1 Alltag Dialog",
    "Deutsch lernen kurze Geschichten",
    "Deutsch Grammatik einfach erklärt",
    "Deutsch hören A2",
  ],
  en: [
    "learn English with subtitles",
    "English A1 everyday dialogue",
    "short English stories for learners",
    "English grammar explained simply",
    "English listening practice A2",
  ],
};

function durationInSeconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

export function inferVideoCategory(text: string): VideoCategory {
  const normalized = text.toLowerCase();
  if (/(grammatik|grammar|artikel|cases?|zeiten|tense|präposition|preposition|konjug)/.test(normalized)) return "grammar";
  if (/(story|geschichte|märchen|fairy tale|read along|lese)/.test(normalized)) return "stories";
  if (/(song|lied|music|musik|poem|gedicht)/.test(normalized)) return "songs";
  if (/(cartoon|animation|zeichentrick)/.test(normalized)) return "cartoons";
  if (/(news|nachrichten|culture|kultur|travel|reise|city|stadt)/.test(normalized)) return "news_culture";
  if (/(vocabulary|wortschatz|words|phrase|wörter)/.test(normalized)) return "vocabulary";
  return "dialogues";
}

export function inferVideoLevel(text: string): VideoCefrLevel {
  const normalized = text.toLowerCase();
  const match = normalized.match(/\b(a1|a2|b1|b2|c1)\b/);
  return match ? (match[1].toUpperCase() as VideoCefrLevel) : "all";
}

function matchesFilters(video: VideoItem, options: SearchOptions): boolean {
  if (options.cefrLevel && options.cefrLevel !== "all" && video.cefrLevel !== options.cefrLevel) return false;
  if (options.category && options.category !== "all" && video.category !== options.category) return false;
  if (options.captionsOnly && !video.hasSubtitles) return false;
  const seconds = durationInSeconds(video.duration);
  if (options.duration === "short" && seconds > 5 * 60) return false;
  if (options.duration === "medium" && (seconds <= 5 * 60 || seconds > 15 * 60)) return false;
  if (options.duration === "long" && seconds <= 15 * 60) return false;
  return true;
}

function getSearchTerms(query: string, lang: "de" | "en"): string {
  const cleaned = query.trim();
  return cleaned || DEFAULT_SEARCH_TOPICS[lang][Math.floor(Date.now() / (30 * 60 * 1000)) % DEFAULT_SEARCH_TOPICS[lang].length];
}

function parseCandidates(html: string, lang: "de" | "en"): Candidate[] {
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s) || html.match(/window\["ytInitialData"\] = ({.+?});<\/script>/s);
  if (!match?.[1]) return [];
  const data = JSON.parse(match[1]);
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents ?? [];
    for (const item of items) {
      const video = item?.videoRenderer;
      if (!video?.videoId || seen.has(video.videoId)) continue;
      const title = video.title?.runs?.map((run: { text: string }) => run.text).join("") || "";
      const duration = video.lengthText?.simpleText || "0:00";
      if (!title || duration === "0:00") continue;
      seen.add(video.videoId);
      candidates.push({
        id: `yt-${video.videoId}`,
        youtubeId: video.videoId,
        title,
        channel: video.ownerText?.runs?.[0]?.text || video.shortBylineText?.runs?.[0]?.text || "YouTube",
        duration,
        thumbnailUrl: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
        description: video.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((run: { text: string }) => run.text).join("") || video.descriptionSnippet?.runs?.map((run: { text: string }) => run.text).join("") || "",
        language: lang,
      });
    }
  }
  return candidates;
}

async function validateCandidate(candidate: Candidate): Promise<VideoItem | null> {
  try {
    const embed = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${candidate.youtubeId}&format=json`, { signal: AbortSignal.timeout(7000) });
    if (!embed.ok) return null;
    // Search must never spend Supadata credits on unopened videos.
    const cues = await readTranscriptCache(candidate.youtubeId, candidate.language).catch(() => null);
    const searchableText = `${candidate.title} ${candidate.description} ${candidate.channel}`;
    return {
      ...candidate,
      cefrLevel: inferVideoLevel(searchableText),
      category: inferVideoCategory(searchableText),
      tags: [],
      hasSubtitles: cues?.length ? true : undefined,
      source: "network",
    };
  } catch {
    return null;
  }
}

export async function searchYouTube(query: string, lang: "de" | "en" = "de", options: SearchOptions = {}): Promise<YouTubeSearchPage> {
  const page = Math.max(0, options.page ?? 0);
  const limit = Math.min(12, Math.max(1, options.limit ?? 12));
  const searchTerms = getSearchTerms(query, lang);
  const cacheKey = JSON.stringify({ query: searchTerms.toLowerCase(), lang, page, limit, ...options });
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (hasOfficialYouTubeApi()) {
    try {
      return await searchYouTubeOfficial(searchTerms, lang, options);
    } catch (error) {
      console.warn("Official YouTube API unavailable; falling back to public search.", error);
    }
  }
  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerms)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": lang === "de" ? "de-DE,de;q=0.9,en;q=0.8" : "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { videos: [], hasMore: false, networkAvailable: false };
    const candidates = parseCandidates(await response.text(), lang);
    const validated = (await Promise.all(candidates.map(validateCandidate))).filter((video): video is VideoItem => video !== null);
    const filtered = validated.filter((video) => matchesFilters(video, options));
    const offset = page * limit;
    const value = { videos: filtered.slice(offset, offset + limit), hasMore: filtered.length > offset + limit, networkAvailable: true };
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("searchYouTube error:", error);
    return { videos: [], hasMore: false, networkAvailable: false };
  }
}

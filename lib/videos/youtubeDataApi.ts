import type { VideoCategory, VideoCefrLevel, VideoDurationFilter, VideoItem } from "./types";

type SearchOptions = {
  page?: number;
  limit?: number;
  cefrLevel?: VideoCefrLevel;
  category?: VideoCategory;
  duration?: VideoDurationFilter;
  captionsOnly?: boolean;
};

type YouTubeItem = {
  id?: string | { videoId?: string; playlistId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; high?: { url?: string } };
  };
  contentDetails?: { duration?: string; videoId?: string };
};

type YouTubeResponse = {
  items?: YouTubeItem[];
  nextPageToken?: string;
};

export type OfficialYouTubeSearchPage = {
  videos: VideoItem[];
  hasMore: boolean;
  networkAvailable: boolean;
};

const API_URL = "https://www.googleapis.com/youtube/v3";
const OFFICIAL_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: OfficialYouTubeSearchPage }>();

function videoId(item: YouTubeItem): string | undefined {
  return typeof item.id === "string" ? item.id : item.id?.videoId;
}

function apiKey(): string | null {
  return process.env.GCP_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return "0:00";
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const totalMinutes = hours * 60 + minutes;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

function durationInSeconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function inferLevel(text: string): VideoCefrLevel {
  const match = text.toLowerCase().match(/\b(a1|a2|b1|b2|c1)\b/);
  return match ? match[1].toUpperCase() as VideoCefrLevel : "all";
}

function inferCategory(text: string): VideoCategory {
  const value = text.toLowerCase();
  if (/(grammatik|grammar|artikel|cases?|zeiten|tense|präposition|preposition|konjug)/.test(value)) return "grammar";
  if (/(story|geschichte|märchen|fairy tale|read along|lese)/.test(value)) return "stories";
  if (/(song|lied|music|musik|poem|gedicht)/.test(value)) return "songs";
  if (/(cartoon|animation|zeichentrick)/.test(value)) return "cartoons";
  if (/(news|nachrichten|culture|kultur|travel|reise|city|stadt)/.test(value)) return "news_culture";
  if (/(vocabulary|wortschatz|words|phrase|wörter)/.test(value)) return "vocabulary";
  return "dialogues";
}

function matchesFilters(video: VideoItem, options: SearchOptions): boolean {
  if (options.cefrLevel && options.cefrLevel !== "all" && video.cefrLevel !== options.cefrLevel) return false;
  if (options.category && options.category !== "all" && video.category !== options.category) return false;
  const seconds = durationInSeconds(video.duration);
  if (options.duration === "short" && seconds > 5 * 60) return false;
  if (options.duration === "medium" && (seconds <= 5 * 60 || seconds > 15 * 60)) return false;
  if (options.duration === "long" && seconds <= 15 * 60) return false;
  return true;
}

async function youtubeFetch(path: string, params: Record<string, string>): Promise<YouTubeResponse> {
  const key = apiKey();
  if (!key) throw new Error("GCP_YOUTUBE_API_KEY is not configured");
  const search = new URLSearchParams({ ...params, key });
  const response = await fetch(`${API_URL}/${path}?${search}`, { signal: AbortSignal.timeout(12000) });
  const data = await response.json() as YouTubeResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `YouTube API returned ${response.status}`);
  return data;
}

async function getVideoDetails(ids: string[]): Promise<Map<string, YouTubeItem>> {
  if (ids.length === 0) return new Map();
  const response = await youtubeFetch("videos", { part: "contentDetails", id: ids.join(",") });
  return new Map((response.items || []).map((item) => [videoId(item) || "", item]));
}

function toVideo(item: YouTubeItem, details: YouTubeItem | undefined, language: "de" | "en", captionsOnly: boolean): VideoItem | null {
  const id = videoId(item);
  const snippet = item.snippet;
  if (!id || !snippet?.title) return null;
  const duration = formatDuration(details?.contentDetails?.duration || "");
  if (duration === "0:00") return null;
  const searchableText = `${snippet.title} ${snippet.description || ""} ${snippet.channelTitle || ""}`;
  return {
    id: `yt-${id}`,
    youtubeId: id,
    title: decodeHtml(snippet.title),
    channel: snippet.channelTitle || "YouTube",
    language,
    duration,
    thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url,
    description: decodeHtml(snippet.description || ""),
    cefrLevel: inferLevel(searchableText),
    category: inferCategory(searchableText),
    tags: [],
    hasSubtitles: captionsOnly ? true : undefined,
    source: "network",
  };
}

export async function searchYouTubeOfficial(query: string, language: "de" | "en", options: SearchOptions = {}): Promise<OfficialYouTubeSearchPage> {
  const page = Math.max(0, options.page || 0);
  const limit = Math.min(12, Math.max(1, options.limit || 12));
  const cacheKey = JSON.stringify({ query, language, page, limit, ...options });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const search = await youtubeFetch("search", {
    part: "snippet",
    q: query,
    type: "video",
    maxResults: "50",
    order: "relevance",
    relevanceLanguage: language,
    videoEmbeddable: "true",
    ...(options.captionsOnly ? { videoCaption: "closedCaption" } : {}),
  });
  const items = search.items || [];
  const details = await getVideoDetails(items.map((item) => videoId(item) || "").filter(Boolean));
  const videos = items
    .map((item) => toVideo(item, details.get(videoId(item) || ""), language, Boolean(options.captionsOnly)))
    .filter((item): item is VideoItem => item !== null)
    .filter((item) => matchesFilters(item, options));
  const offset = page * limit;
  const value = {
    videos: videos.slice(offset, offset + limit),
    hasMore: videos.length > offset + limit || Boolean(search.nextPageToken && offset + limit < 50),
    networkAvailable: true,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + OFFICIAL_CACHE_TTL_MS, value });
  return value;
}

export async function searchYouTubePlaylistOfficial(query: string, language: "de" | "en", options: SearchOptions = {}): Promise<OfficialYouTubeSearchPage> {
  const page = Math.max(0, options.page || 0);
  const limit = Math.min(12, Math.max(1, options.limit || 12));
  const cacheKey = `playlist:${JSON.stringify({ query, language, page, limit })}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const playlistSearch = await youtubeFetch("search", {
    part: "snippet",
    q: query,
    type: "playlist",
    maxResults: "5",
    order: "relevance",
    relevanceLanguage: language,
  });
  const playlist = (playlistSearch.items || []).find((item) => typeof item.id !== "string" && item.id?.playlistId);
  const playlistId = typeof playlist?.id === "string" ? undefined : playlist?.id?.playlistId;
  if (!playlistId) return { videos: [], hasMore: false, networkAvailable: true };

  const items = await youtubeFetch("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: "50",
  });
  const playlistVideos: YouTubeItem[] = [];
  for (const item of items.items || []) {
    const videoId = item.contentDetails?.videoId;
    if (videoId) playlistVideos.push({ ...item, id: { videoId } });
  }
  const details = await getVideoDetails(playlistVideos.map((item) => videoId(item) || "").filter(Boolean));
  const videos = playlistVideos
    .map((item) => toVideo(item, details.get(videoId(item) || ""), language, false))
    .filter((item): item is VideoItem => item !== null);
  const offset = page * limit;
  const value = {
    videos: videos.slice(offset, offset + limit),
    hasMore: videos.length > offset + limit || Boolean(items.nextPageToken && offset + limit < 50),
    networkAvailable: true,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + OFFICIAL_CACHE_TTL_MS, value });
  return value;
}

export function hasOfficialYouTubeApi(): boolean {
  return Boolean(apiKey());
}

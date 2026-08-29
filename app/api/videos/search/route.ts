import { NextResponse } from "next/server";
import { getVideosByLanguage, filterVideos } from "@/lib/videos/data";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { buildVideoSearchIntent } from "@/lib/videos/searchIntent";
import { searchYouTube } from "@/lib/videos/youtubeSearch";
import type { VideoCategory, VideoCefrLevel, VideoDurationFilter, VideoFilters, VideoItem, VideoSearchIntent } from "@/lib/videos/types";

export const runtime = "nodejs";

const DEFAULT_INTENT: VideoSearchIntent = {
  keywords: "",
  cefrLevel: "all",
  category: "all",
  duration: "any",
  captionsOnly: false,
};

function asLanguage(value: string | null): "de" | "en" | "all" {
  return value === "en" || value === "all" ? value : "de";
}

function asLevel(value: string | null): VideoCefrLevel {
  return ["A1", "A2", "B1", "B2", "C1"].includes(value ?? "") ? value as VideoCefrLevel : "all";
}

function asCategory(value: string | null): VideoCategory {
  const categories: VideoCategory[] = ["all", "dialogues", "grammar", "vocabulary", "stories", "news_culture", "cartoons", "songs"];
  return categories.includes(value as VideoCategory) ? value as VideoCategory : "all";
}

function asDuration(value: string | null): VideoDurationFilter {
  return value === "short" || value === "medium" || value === "long" ? value : "any";
}

async function resolveIntent(request: Request, query: string, language: "de" | "en", useAi: boolean): Promise<{ intent: VideoSearchIntent; aiApplied: boolean }> {
  if (!useAi || !query.trim()) return { intent: { ...DEFAULT_INTENT, keywords: query }, aiApplied: false };
  try {
    const apiKey = await getApiKeyForRequest(request);
    return { intent: await buildVideoSearchIntent(apiKey, query, language), aiApplied: true };
  } catch (error) {
    console.warn("Video search intent unavailable; using the literal query.", error);
    return { intent: { ...DEFAULT_INTENT, keywords: query }, aiApplied: false };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contextualQuery = searchParams.get("word") || searchParams.get("book") || "";
  const query = (searchParams.get("q") || contextualQuery).trim();
  const language = asLanguage(searchParams.get("lang"));
  const requestedLevel = asLevel(searchParams.get("level"));
  const requestedCategory = asCategory(searchParams.get("category"));
  const requestedDuration = asDuration(searchParams.get("duration"));
  const requestedCaptions = searchParams.get("captions") === "true";
  const page = Math.max(0, Number.parseInt(searchParams.get("page") || "0", 10) || 0);
  const limit = Math.min(12, Math.max(1, Number.parseInt(searchParams.get("limit") || "12", 10) || 12));
  const useAi = searchParams.get("ai") === "true";
  const intentLanguage = language === "en" ? "en" : "de";
  const { intent, aiApplied } = await resolveIntent(request, query, intentLanguage, useAi);
  const filters: VideoFilters = {
    language,
    cefrLevel: requestedLevel === "all" ? intent.cefrLevel : requestedLevel,
    category: requestedCategory === "all" ? intent.category : requestedCategory,
    duration: requestedDuration === "any" ? intent.duration : requestedDuration,
    captionsOnly: requestedCaptions || intent.captionsOnly,
  };

  const searchOptions = {
    page,
    limit,
    cefrLevel: filters.cefrLevel,
    category: filters.category,
    duration: filters.duration,
    captionsOnly: filters.captionsOnly,
  };
  const searches = language === "all"
    ? await Promise.all([searchYouTube(intent.keywords, "de", searchOptions), searchYouTube(intent.keywords, "en", searchOptions)])
    : [await searchYouTube(intent.keywords, language, searchOptions)];
  const networkVideos = searches.flatMap((result) => result.videos);
  const networkAvailable = searches.some((result) => result.networkAvailable);
  const hasMore = searches.some((result) => result.hasMore);

  if (networkVideos.length > 0) {
    return NextResponse.json({
      videos: networkVideos,
      nextPage: hasMore ? page + 1 : null,
      source: "network",
      networkAvailable,
      aiApplied,
      intent,
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  const fallback = filterVideos(getVideosByLanguage(language), filters)
    .slice(page * limit, (page + 1) * limit)
    .map((video): VideoItem => ({ ...video, source: "fallback" }));
  return NextResponse.json({
    videos: fallback,
    nextPage: fallback.length === limit ? page + 1 : null,
    source: "fallback",
    networkAvailable,
    aiApplied,
    intent,
    warning: networkAvailable ? "Подходящих видео в YouTube не найдено; показана резервная подборка." : "YouTube временно недоступен; показана резервная подборка.",
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}

import { NextResponse } from "next/server";
import {
  ALL_VIDEOS,
  filterVideos,
  findVideosForWord,
  findVideosForBook,
} from "@/lib/videos/data";
import { searchYouTube } from "@/lib/videos/youtubeSearch";
import type { VideoCategory, VideoCefrLevel, VideoItem } from "@/lib/videos/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q");
  const lang = (searchParams.get("lang") || "de") as "de" | "en" | "all";
  const level = (searchParams.get("level") || "all") as VideoCefrLevel;
  const category = (searchParams.get("category") || "all") as VideoCategory;
  const word = searchParams.get("word");
  const book = searchParams.get("book");
  const live = searchParams.get("live") === "true" || !!q;

  // Contextual search by word
  if (word) {
    const matched = findVideosForWord(word, lang === "all" ? "de" : lang);
    return NextResponse.json({ videos: matched, total: matched.length });
  }

  // Contextual search by book
  if (book) {
    const matched = findVideosForBook(book, lang === "all" ? "de" : lang);
    return NextResponse.json({ videos: matched, total: matched.length });
  }

  // General filter over curated items
  let results = filterVideos(ALL_VIDEOS, {
    language: lang,
    cefrLevel: level,
    category: category,
    searchQuery: q || undefined,
  });

  // If search query is provided and we want YouTube live results, enrich with YouTube search
  if (q && q.trim().length > 1 && live) {
    try {
      const searchLang = lang === "en" ? "en" : "de";
      const ytResults = await searchYouTube(q, searchLang, 8);
      const ytVideoItems: VideoItem[] = ytResults
        .filter((y) => !results.some((r) => r.youtubeId === y.youtubeId))
        .map((y) => ({
          id: y.id,
          youtubeId: y.youtubeId,
          title: y.title,
          channel: y.channel,
          duration: y.duration,
          thumbnailUrl: y.thumbnailUrl,
          description: y.description,
          language: y.language,
          cefrLevel: "all",
          category: "all",
          tags: [q.toLowerCase()],
        }));

      results = [...results, ...ytVideoItems];
    } catch (e) {
      console.error("Live YouTube search error in route:", e);
    }
  }

  return NextResponse.json({
    videos: results,
    total: results.length,
  });
}

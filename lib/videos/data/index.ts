import { GERMAN_VIDEOS } from "./germanVideos";
import { ENGLISH_VIDEOS } from "./englishVideos";
import { VIDEO_CATEGORIES } from "./categories";
import { VIDEO_PLAYLISTS } from "./playlists";
import type { VideoItem, VideoFilters } from "../types";

export { GERMAN_VIDEOS, ENGLISH_VIDEOS, VIDEO_CATEGORIES, VIDEO_PLAYLISTS };

export const ALL_VIDEOS: VideoItem[] = [...GERMAN_VIDEOS, ...ENGLISH_VIDEOS];

function durationInMinutes(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0] ?? 0;
}

export function getVideosByLanguage(lang: "de" | "en" | "all" = "de"): VideoItem[] {
  if (lang === "all") return ALL_VIDEOS;
  if (lang === "en") return ENGLISH_VIDEOS;
  return GERMAN_VIDEOS;
}

export function filterVideos(videos: VideoItem[], filters: VideoFilters): VideoItem[] {
  return videos.filter((video) => {
    if (filters.language && filters.language !== "all") {
      if (video.language !== filters.language) return false;
    }

    if (filters.cefrLevel && filters.cefrLevel !== "all") {
      if (video.cefrLevel !== filters.cefrLevel && video.cefrLevel !== "all") {
        return false;
      }
    }

    if (filters.category && filters.category !== "all") {
      if (video.category !== filters.category) return false;
    }

    if (filters.duration && filters.duration !== "any") {
      const minutes = durationInMinutes(video.duration);
      const matchesDuration =
        (filters.duration === "short" && minutes <= 5) ||
        (filters.duration === "medium" && minutes > 5 && minutes <= 15) ||
        (filters.duration === "long" && minutes > 15);
      if (!matchesDuration) return false;
    }

    if (filters.captionsOnly && !video.hasSubtitles) return false;

    if (filters.searchQuery && filters.searchQuery.trim().length > 0) {
      const q = filters.searchQuery.trim().toLowerCase();
      const matchTitle = video.title.toLowerCase().includes(q);
      const matchTitleRu = video.titleRu?.toLowerCase().includes(q) ?? false;
      const matchChannel = video.channel.toLowerCase().includes(q);
      const matchTags = video.tags.some((tag) => tag.toLowerCase().includes(q));
      const matchVocab = video.keyVocabulary?.some(
        (v) =>
          v.word.toLowerCase().includes(q) ||
          v.translation.toLowerCase().includes(q)
      ) ?? false;

      if (!matchTitle && !matchTitleRu && !matchChannel && !matchTags && !matchVocab) {
        return false;
      }
    }

    return true;
  });
}

export function findVideosForWord(word: string, lang: "de" | "en" = "de"): VideoItem[] {
  const cleanWord = word.trim().toLowerCase().replace(/^(der|die|das|ein|eine|to)\s+/i, "");
  const pool = getVideosByLanguage(lang);

  const exactVocab = pool.filter((v) =>
    v.keyVocabulary?.some((k) =>
      k.word.toLowerCase().includes(cleanWord) ||
      cleanWord.includes(k.word.toLowerCase().replace(/^(der|die|das|ein|eine|to)\s+/i, ""))
    )
  );
  if (exactVocab.length > 0) return exactVocab;

  const tagMatch = pool.filter((v) =>
    v.tags.some((t) => t.toLowerCase().includes(cleanWord))
  );
  if (tagMatch.length > 0) return tagMatch;

  return filterVideos(pool, { searchQuery: cleanWord, language: lang });
}

export function findVideosForBook(bookTitle: string, lang: "de" | "en" = "de"): VideoItem[] {
  const clean = bookTitle.trim().toLowerCase();
  const pool = getVideosByLanguage(lang);

  const direct = pool.filter((v) =>
    clean.split(/\s+/).some((token) => token.length > 3 && v.title.toLowerCase().includes(token)) ||
    v.tags.some((t) => clean.includes(t))
  );

  if (direct.length > 0) return direct;
  return pool.slice(0, 6);
}

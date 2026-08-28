"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Search, X, Loader2, Sparkles, Filter } from "lucide-react";
import { VideoCard } from "./VideoCard";
import { VideoPlayerModal } from "./VideoPlayerModal";
import {
  ALL_VIDEOS,
  VIDEO_CATEGORIES,
  filterVideos,
  getVideosByLanguage,
} from "@/lib/videos/data";
import type {
  VideoItem,
  VideoCategory,
  VideoCefrLevel,
} from "@/lib/videos/types";
import type { Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  initialQuery?: string | null;
  initialLanguage?: string | null;
  onAddCard: (card: Flashcard) => void;
};

const QUICK_TAGS = [
  { label: "Nicos Weg", query: "nicos weg" },
  { label: "Easy German", query: "easy german" },
  { label: "Животные", query: "tiere" },
  { label: "Цвета", query: "farben" },
  { label: "Дом и мебель", query: "wohnen" },
  { label: "Профессии", query: "berufe" },
  { label: "Грамматика", query: "grammatik" },
  { label: "Сказки", query: "märchen" },
];

const CEFR_LEVELS: { id: VideoCefrLevel; label: string }[] = [
  { id: "all", label: "Все уровни" },
  { id: "A1", label: "A1 (Начальный)" },
  { id: "A2", label: "A2 (Базовый)" },
  { id: "B1", label: "B1 (Средний)" },
  { id: "B2", label: "B2 (Продвинутый)" },
];

export function VideosView({
  cards,
  profile,
  initialQuery,
  initialLanguage,
  onAddCard,
}: Props) {
  const [language, setLanguage] = useState<"de" | "en" | "all">(
    (initialLanguage as "de" | "en" | "all") || (profile.targetLanguage === "en" ? "en" : "de")
  );
  const [category, setCategory] = useState<VideoCategory>("all");
  const [cefrLevel, setCefrLevel] = useState<VideoCefrLevel>("all");
  const [searchQuery, setSearchQuery] = useState(initialQuery || "");
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery || "");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Search execution
  const executeSearch = useCallback(
    async (queryText: string, currentLang: "de" | "en" | "all", cat: VideoCategory, lvl: VideoCefrLevel) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (queryText.trim()) params.set("q", queryText.trim());
        if (currentLang !== "all") params.set("lang", currentLang);
        if (lvl !== "all") params.set("level", lvl);
        if (cat !== "all") params.set("category", cat);

        const res = await fetch(`/api/videos/search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json() as { videos?: VideoItem[] };
          if (Array.isArray(data.videos) && data.videos.length > 0) {
            setVideos(data.videos);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn("API video search error, falling back to local dataset:", err);
      }

      // Local fallback
      const base = getVideosByLanguage(currentLang);
      const filtered = filterVideos(base, {
        language: currentLang,
        category: cat,
        cefrLevel: lvl,
        searchQuery: queryText,
      });
      setVideos(filtered);
      setIsLoading(false);
    },
    []
  );

  // React to filter changes
  useEffect(() => {
    void executeSearch(submittedQuery, language, category, cefrLevel);
  }, [submittedQuery, language, category, cefrLevel, executeSearch]);

  // Handle incoming initial props
  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery);
      setSubmittedQuery(initialQuery);
    }
    if (initialLanguage) {
      setLanguage(initialLanguage as "de" | "en" | "all");
    }
  }, [initialQuery, initialLanguage]);

  function handleSearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSubmittedQuery(searchQuery.trim());
  }

  function handleClearSearch() {
    setSearchQuery("");
    setSubmittedQuery("");
  }

  function handleTagClick(tagQuery: string) {
    setSearchQuery(tagQuery);
    setSubmittedQuery(tagQuery);
  }

  const relatedVideos = useMemo(() => {
    if (!selectedVideo) return [];
    return videos.filter((v) => v.id !== selectedVideo.id);
  }, [selectedVideo, videos]);

  return (
    <div className="videos-tab-container">
      {/* ── Search & Filter Toolbar ───────────────────────────────────────── */}
      <div className="videos-toolbar">
        {/* Search Bar */}
        <form className="videos-search-form" onSubmit={handleSearchSubmit}>
          <div className="videos-search-input-wrap">
            <Search size={16} className="videos-search-icon" aria-hidden />
            <input
              type="text"
              placeholder="Поиск по теме, слову или базе YouTube..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="videos-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="videos-clear-btn"
                onClick={handleClearSearch}
                aria-label="Очистить"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button type="submit" className="pill-btn videos-submit-btn">
            Найти
          </button>
        </form>

        {/* Quick Tag Pills */}
        <div className="videos-quick-tags" role="toolbar" aria-label="Быстрый поиск">
          {QUICK_TAGS.map((tag) => (
            <button
              key={tag.label}
              type="button"
              className={`videos-tag-pill ${submittedQuery.toLowerCase() === tag.query.toLowerCase() ? "active" : ""}`}
              onClick={() => handleTagClick(tag.query)}
            >
              {tag.label}
            </button>
          ))}
        </div>

        {/* Controls Bar: Language + CEFR Level */}
        <div className="videos-controls-row">
          <div className="videos-segmented-group" role="group" aria-label="Выбор языка">
            <button
              type="button"
              className={`videos-segment-btn ${language === "de" ? "active" : ""}`}
              onClick={() => setLanguage("de")}
            >
              Немецкий
            </button>
            <button
              type="button"
              className={`videos-segment-btn ${language === "en" ? "active" : ""}`}
              onClick={() => setLanguage("en")}
            >
              Английский
            </button>
            <button
              type="button"
              className={`videos-segment-btn ${language === "all" ? "active" : ""}`}
              onClick={() => setLanguage("all")}
            >
              Все языки
            </button>
          </div>

          <div className="videos-levels-group" role="group" aria-label="Уровень сложности">
            {CEFR_LEVELS.map((lvl) => (
              <button
                key={lvl.id}
                type="button"
                className={`videos-level-pill ${cefrLevel === lvl.id ? "active" : ""}`}
                onClick={() => setCefrLevel(lvl.id)}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="videos-categories-bar" role="tablist" aria-label="Категории видео">
          {VIDEO_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`videos-cat-tab ${category === cat.id ? "active" : ""}`}
              onClick={() => setCategory(cat.id)}
            >
              {cat.title}
            </button>
          ))}
        </div>
      </div>

      {/* ── Status / Count Bar ────────────────────────────────────────────── */}
      <div className="videos-meta-row">
        <div className="videos-count-info">
          {isLoading ? (
            <span className="videos-loading-text">
              <Loader2 size={13} className="spin" />
              <span>Поиск видеоматериалов...</span>
            </span>
          ) : (
            <span>Найдено видео: <strong>{videos.length}</strong></span>
          )}
        </div>
        {submittedQuery && (
          <button
            type="button"
            className="videos-reset-query-btn"
            onClick={handleClearSearch}
          >
            Сбросить поиск «{submittedQuery}»
          </button>
        )}
      </div>

      {/* ── Video Grid ────────────────────────────────────────────────────── */}
      {isLoading && videos.length === 0 ? (
        <div className="videos-loading-state">
          <Loader2 size={28} className="spin" />
          <p>Загрузка видео...</p>
        </div>
      ) : videos.length > 0 ? (
        <div className="videos-grid">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onSelect={setSelectedVideo}
            />
          ))}
        </div>
      ) : (
        <div className="videos-empty-state">
          <p className="videos-empty-title">Видео не найдены</p>
          <p className="videos-empty-desc">
            Попробуйте изменить поисковый запрос или выбрать другие фильтры.
          </p>
          <button
            type="button"
            className="pill-btn"
            onClick={() => {
              setSearchQuery("");
              setSubmittedQuery("");
              setCategory("all");
              setCefrLevel("all");
            }}
          >
            Показать все видео
          </button>
        </div>
      )}

      {/* ── Player Modal ──────────────────────────────────────────────────── */}
      {selectedVideo && (
        <VideoPlayerModal
          video={selectedVideo}
          cards={cards}
          profile={profile}
          relatedVideos={relatedVideos}
          onClose={() => setSelectedVideo(null)}
          onSelectVideo={setSelectedVideo}
          onAddCard={onAddCard}
        />
      )}
    </div>
  );
}

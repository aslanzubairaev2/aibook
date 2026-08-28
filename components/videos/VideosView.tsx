"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Search, X, SlidersHorizontal, ChevronDown, Loader2 } from "lucide-react";
import type { VideoItem, VideoCefrLevel, VideoCategory } from "@/lib/videos/types";
import { VIDEO_CATEGORIES, getVideosByLanguage, filterVideos } from "@/lib/videos/data";
import { VideoCard } from "./VideoCard";
import { VideoPlayerModal } from "./VideoPlayerModal";
import type { Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  initialQuery?: string | null;
  initialLanguage?: string | null;
  onAddCard?: (card: Flashcard) => void;
};

export function VideosView({
  profile,
  initialQuery,
  initialLanguage,
  onAddCard,
}: Props) {
  const defaultLang = initialLanguage === "en" || profile.targetLanguage === "en" ? "en" : "de";

  const [selectedLang, setSelectedLang] = useState<"de" | "en" | "all">(defaultLang);
  const [selectedCefr, setSelectedCefr] = useState<VideoCefrLevel>("all");
  const [selectedCategory, setSelectedCategory] = useState<VideoCategory>("all");
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(initialQuery ?? "");
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // YouTube live search results
  const [liveResults, setLiveResults] = useState<VideoItem[]>([]);
  const [isSearchingLive, setIsSearchingLive] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery);
      setSubmittedSearch(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (initialLanguage) {
      setSelectedLang(initialLanguage === "en" ? "en" : "de");
    }
  }, [initialLanguage]);

  // Live YouTube search
  const performLiveSearch = useCallback(async (query: string, lang: "de" | "en" | "all") => {
    if (!query || query.trim().length < 2) {
      setLiveResults([]);
      return;
    }

    setIsSearchingLive(true);
    try {
      const res = await fetch(
        `/api/videos/search?q=${encodeURIComponent(query.trim())}&lang=${lang}`
      );
      if (res.ok) {
        const data = await res.json();
        setLiveResults(data.videos || []);
      } else {
        setLiveResults([]);
      }
    } catch (err) {
      console.error("Live video search failed:", err);
      setLiveResults([]);
    } finally {
      setIsSearchingLive(false);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(searchQuery);
    if (searchQuery.trim().length >= 2) {
      void performLiveSearch(searchQuery, selectedLang);
    } else {
      setLiveResults([]);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSubmittedSearch("");
    setLiveResults([]);
  };

  // Local curated filtered videos
  const curatedVideos = useMemo(() => {
    const base = getVideosByLanguage(selectedLang);
    return filterVideos(base, {
      language: selectedLang,
      cefrLevel: selectedCefr,
      category: selectedCategory,
      searchQuery: submittedSearch,
    });
  }, [selectedLang, selectedCefr, selectedCategory, submittedSearch]);

  // Combined video list
  const displayVideos = useMemo(() => {
    if (submittedSearch.trim().length >= 2 && liveResults.length > 0) {
      const seenIds = new Set<string>();
      const combined: VideoItem[] = [];

      for (const v of curatedVideos) {
        seenIds.add(v.youtubeId);
        combined.push(v);
      }

      for (const v of liveResults) {
        if (!seenIds.has(v.youtubeId)) {
          seenIds.add(v.youtubeId);
          combined.push(v);
        }
      }

      return combined;
    }
    return curatedVideos;
  }, [curatedVideos, liveResults, submittedSearch]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedLang !== defaultLang) count++;
    if (selectedCefr !== "all") count++;
    if (selectedCategory !== "all") count++;
    return count;
  }, [selectedLang, defaultLang, selectedCefr, selectedCategory]);

  const resetFilters = () => {
    setSelectedLang(defaultLang);
    setSelectedCefr("all");
    setSelectedCategory("all");
    setSearchQuery("");
    setSubmittedSearch("");
    setLiveResults([]);
  };

  return (
    <div className="videos-tab-container">
      {/* Search Bar + Filter Accordion Button */}
      <form className="videos-search-row" onSubmit={handleSearchSubmit}>
        <div className="videos-search-input-wrap">
          <Search size={15} className="videos-search-icon" aria-hidden />
          <input
            type="search"
            className="videos-search-input"
            placeholder="Поиск видео по теме или слову..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="videos-clear-btn"
              onClick={handleClearSearch}
              aria-label="Очистить поиск"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`all-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal size={14} />
          <span>Фильтры</span>
          {activeFilterCount > 0 && (
            <span className="all-filter-count">{activeFilterCount}</span>
          )}
          <ChevronDown
            size={13}
            style={{
              transform: filtersOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>

        <button type="submit" className="videos-search-submit-btn">
          Найти
        </button>
      </form>

      {/* Collapsible Filter Panel */}
      {filtersOpen && (
        <div className="all-filter-panel">
          {/* Language Group */}
          <div className="filter-group">
            <div className="filter-group-label">Язык</div>
            <div className="filter-chips">
              <button
                type="button"
                className={`filter-chip ${selectedLang === "de" ? "active" : ""}`}
                onClick={() => setSelectedLang("de")}
              >
                Немецкий
              </button>
              <button
                type="button"
                className={`filter-chip ${selectedLang === "en" ? "active" : ""}`}
                onClick={() => setSelectedLang("en")}
              >
                Английский
              </button>
              <button
                type="button"
                className={`filter-chip ${selectedLang === "all" ? "active" : ""}`}
                onClick={() => setSelectedLang("all")}
              >
                Все языки
              </button>
            </div>
          </div>

          {/* CEFR Level Group */}
          <div className="filter-group">
            <div className="filter-group-label">Уровень сложности</div>
            <div className="filter-chips">
              <button
                type="button"
                className={`filter-chip ${selectedCefr === "all" ? "active" : ""}`}
                onClick={() => setSelectedCefr("all")}
              >
                Все уровни
              </button>
              {(["A1", "A2", "B1", "B2"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`filter-chip ${selectedCefr === level ? "active" : ""}`}
                  onClick={() => setSelectedCefr(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Category Group */}
          <div className="filter-group">
            <div className="filter-group-label">Категория</div>
            <div className="filter-chips">
              {VIDEO_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`filter-chip ${selectedCategory === cat.id ? "active" : ""}`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.title}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Topics */}
          <div className="filter-group">
            <div className="filter-group-label">Быстрые темы</div>
            <div className="filter-chips">
              {["Nicos Weg", "Easy German", "Животные", "Цвета", "Дом", "Профессии", "Грамматика", "Сказки"].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`filter-chip ${submittedSearch.toLowerCase() === tag.toLowerCase() ? "active" : ""}`}
                  onClick={() => {
                    setSearchQuery(tag);
                    setSubmittedSearch(tag);
                    void performLiveSearch(tag, selectedLang);
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Meta row: count and reset */}
      <div className="videos-count-row">
        <span className="videos-count-text">
          {isSearchingLive ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Loader2 size={13} className="spin" /> Поиск в базе YouTube...
            </span>
          ) : (
            `Найдено видео: ${displayVideos.length}`
          )}
        </span>

        {(activeFilterCount > 0 || submittedSearch) && (
          <button type="button" className="videos-reset-filters-btn" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>

      {/* Video Grid */}
      {displayVideos.length > 0 ? (
        <div className="videos-grid">
          {displayVideos.map((video) => (
            <VideoCard
              key={video.id || video.youtubeId}
              video={video}
              onSelect={setActiveVideo}
            />
          ))}
        </div>
      ) : (
        <div className="seed-card" style={{ padding: "32px 16px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            {isSearchingLive ? "Загрузка видео..." : "Видео не найдены по выбранным фильтрам."}
          </p>
        </div>
      )}

      {/* Player Modal */}
      {activeVideo && (
        <VideoPlayerModal
          video={activeVideo}
          profile={profile}
          onClose={() => setActiveVideo(null)}
          onAddCard={onAddCard}
        />
      )}
    </div>
  );
}

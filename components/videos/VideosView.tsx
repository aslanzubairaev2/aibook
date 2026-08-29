"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, ChevronDown, History, Heart, Loader2, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { getAiHeaders } from "@/lib/ai/analyze";
import { VIDEO_CATEGORIES, VIDEO_PLAYLISTS } from "@/lib/videos/data";
import type { VideoCategory, VideoCefrLevel, VideoDurationFilter, VideoItem, VideoSearchIntent } from "@/lib/videos/types";
import type { Flashcard, UserProfile } from "@/lib/types";
import { VideoCard } from "./VideoCard";
import { VideoPlayerModal } from "./VideoPlayerModal";
import { sbGetVideoLibrary, sbUpsertVideoLibrary } from "@/lib/db/supabase";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  initialQuery?: string | null;
  initialLanguage?: string | null;
  onAddCard?: (card: Flashcard) => void;
  userId?: string | null;
};

type SearchResponse = {
  videos: VideoItem[];
  nextPage: number | null;
  source: "network" | "fallback";
  networkAvailable: boolean;
  aiApplied: boolean;
  intent: VideoSearchIntent;
  warning?: string;
};

const QUICK_TOPICS = ["Разговор в аэропорту", "Работа", "Животные", "Еда", "Грамматика", "Сказки"];
const VIDEO_FAVORITES_KEY = "aibook_video_favorites_v1";
const VIDEO_HISTORY_KEY = "aibook_video_history_v1";
type VideoCollection = "search" | "favorites" | "history";

async function getVideoSearchHeaders(): Promise<HeadersInit> {
  try {
    return await getAiHeaders();
  } catch {
    // AI is optional: the network search itself must remain available.
    return {};
  }
}

export function VideosView({ profile, initialQuery, initialLanguage, onAddCard, userId }: Props) {
  const defaultLang = initialLanguage === "en" || profile.targetLanguage === "en" ? "en" : "de";
  const [selectedLang, setSelectedLang] = useState<"de" | "en" | "all">(defaultLang);
  const [selectedCefr, setSelectedCefr] = useState<VideoCefrLevel>("all");
  const [selectedCategory, setSelectedCategory] = useState<VideoCategory>("all");
  const [selectedDuration, setSelectedDuration] = useState<VideoDurationFilter>("any");
  const [captionsOnly, setCaptionsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(initialQuery ?? "");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<VideoSearchIntent | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [favorites, setFavorites] = useState<VideoItem[]>([]);
  const [history, setHistory] = useState<VideoItem[]>([]);
  const [collection, setCollection] = useState<VideoCollection>("search");
  const [progress, setProgress] = useState<Record<string, { percent: number; position: number; maxPosition: number }>>({});
  const requestId = useRef(0);

  useEffect(() => {
    try {
      setFavorites(JSON.parse(localStorage.getItem(VIDEO_FAVORITES_KEY) || "[]") as VideoItem[]);
      setHistory(JSON.parse(localStorage.getItem(VIDEO_HISTORY_KEY) || "[]") as VideoItem[]);
    } catch {
      setFavorites([]);
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void sbGetVideoLibrary(userId).then((rows) => {
      const nextProgress: Record<string, { percent: number; position: number; maxPosition: number }> = {};
      const remoteFavorites: VideoItem[] = [];
      const remoteHistory: VideoItem[] = [];
      for (const row of rows) {
        nextProgress[row.youtube_id] = { percent: Number(row.progress_percent) || 0, position: Number(row.last_position_seconds) || 0, maxPosition: Number(row.max_position_seconds) || 0 };
        const video: VideoItem = {
          id: `yt-${row.youtube_id}`,
          youtubeId: row.youtube_id,
          title: row.title,
          channel: row.channel,
          language: row.language as VideoItem["language"],
          duration: row.duration,
          thumbnailUrl: row.thumbnail_url ?? undefined,
          description: row.description ?? undefined,
          cefrLevel: row.cefr_level as VideoItem["cefrLevel"],
          category: row.category as VideoItem["category"],
          tags: [],
          source: "network",
        };
        if (row.is_favorite) remoteFavorites.push(video);
        remoteHistory.push(video);
      }
      setProgress(nextProgress);
      setFavorites(remoteFavorites);
      setHistory(remoteHistory);
    });
  }, [userId]);

  const toggleFavorite = (video: VideoItem) => {
    setFavorites((current) => {
      const next = current.some((item) => item.youtubeId === video.youtubeId)
        ? current.filter((item) => item.youtubeId !== video.youtubeId)
        : [video, ...current].slice(0, 100);
      localStorage.setItem(VIDEO_FAVORITES_KEY, JSON.stringify(next));
      if (userId) void sbUpsertVideoLibrary({ user_id: userId, video, is_favorite: next.some((item) => item.youtubeId === video.youtubeId) });
      return next;
    });
  };

  const selectVideo = (video: VideoItem) => {
    setHistory((current) => {
      const next = [video, ...current.filter((item) => item.youtubeId !== video.youtubeId)].slice(0, 100);
      localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(next));
      if (userId) void sbUpsertVideoLibrary({ user_id: userId, video, is_favorite: favorites.some((item) => item.youtubeId === video.youtubeId), last_position_seconds: progress[video.youtubeId]?.position || 0, max_position_seconds: progress[video.youtubeId]?.maxPosition || 0, progress_percent: progress[video.youtubeId]?.percent || 0 });
      return next;
    });
    setActiveVideo(video);
  };

  const activeFilterCount = useMemo(() => {
    return Number(selectedLang !== defaultLang) + Number(selectedCefr !== "all") + Number(selectedCategory !== "all") + Number(selectedDuration !== "any") + Number(captionsOnly);
  }, [captionsOnly, defaultLang, selectedCategory, selectedCefr, selectedDuration, selectedLang]);

  const loadVideos = useCallback(async (page: number, append: boolean, query = submittedSearch, playlistQuery = "") => {
    const currentRequest = ++requestId.current;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    if (!append) setWarning(null);
    try {
      const params = new URLSearchParams({
        lang: selectedLang,
        level: selectedCefr,
        category: selectedCategory,
        duration: selectedDuration,
        captions: String(captionsOnly),
        page: String(page),
        limit: "12",
        ai: "true",
      });
      if (query.trim()) params.set("q", query.trim());
      if (playlistQuery.trim()) {
        params.delete("q");
        params.set("playlist", playlistQuery.trim());
      }
      const response = await fetch(`/api/videos/search?${params}`, { headers: await getVideoSearchHeaders() });
      const data = await response.json() as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось получить видео из YouTube.");
      if (currentRequest !== requestId.current) return;
      setVideos((previous) => append ? [...previous, ...data.videos.filter((item) => !previous.some((old) => old.youtubeId === item.youtubeId))] : data.videos);
      setNextPage(data.nextPage);
      setWarning(data.warning ?? null);
      setIntent(data.intent);
      setAiApplied(data.aiApplied);
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : "Не удалось получить видео из YouTube.");
      if (!append) setVideos([]);
    } finally {
      if (currentRequest === requestId.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [captionsOnly, selectedCategory, selectedCefr, selectedDuration, selectedLang, submittedSearch]);

  useEffect(() => {
    void loadVideos(0, false, initialQuery ?? "");
  // The initial request deliberately follows route inputs only; filters trigger submit/reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLanguage, initialQuery]);

  useEffect(() => {
    if (reloadNonce > 0) void loadVideos(0, false);
  }, [loadVideos, reloadNonce]);

  useEffect(() => {
    if (initialLanguage) setSelectedLang(initialLanguage === "en" ? "en" : "de");
  }, [initialLanguage]);

  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery);
      setSubmittedSearch(initialQuery);
    }
  }, [initialQuery]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    setCollection("search");
    setSubmittedSearch(query);
    void loadVideos(0, false, query);
  };

  const chooseQuickTopic = (topic: string) => {
    setCollection("search");
    setSearchQuery(topic);
    setSubmittedSearch(topic);
    void loadVideos(0, false, topic);
  };

  const choosePlaylist = (playlistId: string) => {
    const playlist = VIDEO_PLAYLISTS.find((item) => item.id === playlistId);
    if (!playlist) return;
    setCollection("search");
    setSearchQuery(playlist.query);
    setSubmittedSearch("");
    void loadVideos(0, false, "", playlist.query);
  };

  const resetFilters = () => {
    setSelectedLang(defaultLang);
    setSelectedCefr("all");
    setSelectedCategory("all");
    setSelectedDuration("any");
    setCaptionsOnly(false);
    setSearchQuery("");
    setSubmittedSearch("");
    setReloadNonce((value) => value + 1);
  };

  return (
    <div className="videos-tab-container">
      <form className="videos-search-row" onSubmit={submitSearch}>
        <div className="videos-search-input-wrap">
          <Search size={15} className="videos-search-icon" aria-hidden />
          <input
            type="search"
            className="videos-search-input"
            placeholder="Например: короткий диалог в аэропорту для A1"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
            }}
          />
          {searchQuery && <button type="button" className="videos-clear-btn" onClick={() => setSearchQuery("")} aria-label="Очистить поиск"><X size={14} /></button>}
        </div>
        <button type="button" className={`all-filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
          <SlidersHorizontal size={14} /><span>Фильтры</span>{activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}<ChevronDown size={13} style={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        <button type="submit" className="videos-search-submit-btn"><Sparkles size={14} /> Найти</button>
      </form>

      <label className="videos-playlist-select-wrap">
        <span>Подборка</span>
        <select
          className="videos-playlist-select"
          defaultValue=""
          aria-label="Выбрать тематическую подборку видео"
          onChange={(event) => choosePlaylist(event.target.value)}
        >
          <option value="">Выберите курс или плейлист</option>
          {VIDEO_PLAYLISTS.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title} — {playlist.description}</option>)}
        </select>
      </label>

      <div className="videos-collection-tabs" role="tablist" aria-label="Мои видео">
        <button type="button" className={collection === "favorites" ? "active" : ""} onClick={() => setCollection("favorites")}><Heart size={14} /> Избранное ({favorites.length})</button>
        <button type="button" className={collection === "history" ? "active" : ""} onClick={() => setCollection("history")}><History size={14} /> История ({history.length})</button>
        {collection !== "search" && <button type="button" onClick={() => setCollection("search")}>Результаты поиска</button>}
      </div>

      {filtersOpen && (
        <div className="all-filter-panel">
          <FilterGroup label="Язык">
            <FilterChip active={selectedLang === "de"} onClick={() => setSelectedLang("de")}>Немецкий</FilterChip>
            <FilterChip active={selectedLang === "en"} onClick={() => setSelectedLang("en")}>Английский</FilterChip>
            <FilterChip active={selectedLang === "all"} onClick={() => setSelectedLang("all")}>Все языки</FilterChip>
          </FilterGroup>
          <FilterGroup label="Уровень сложности">
            <FilterChip active={selectedCefr === "all"} onClick={() => setSelectedCefr("all")}>Все уровни</FilterChip>
            {(["A1", "A2", "B1", "B2"] as const).map((level) => <FilterChip key={level} active={selectedCefr === level} onClick={() => setSelectedCefr(level)}>{level}</FilterChip>)}
          </FilterGroup>
          <FilterGroup label="Категория">
            {VIDEO_CATEGORIES.map((category) => <FilterChip key={category.id} active={selectedCategory === category.id} onClick={() => setSelectedCategory(category.id)}>{category.title}</FilterChip>)}
          </FilterGroup>
          <FilterGroup label="Длительность">
            <FilterChip active={selectedDuration === "any"} onClick={() => setSelectedDuration("any")}>Любая</FilterChip>
            <FilterChip active={selectedDuration === "short"} onClick={() => setSelectedDuration("short")}>До 5 мин</FilterChip>
            <FilterChip active={selectedDuration === "medium"} onClick={() => setSelectedDuration("medium")}>5–15 мин</FilterChip>
            <FilterChip active={selectedDuration === "long"} onClick={() => setSelectedDuration("long")}>От 15 мин</FilterChip>
            <FilterChip className="video-captions-filter" active={captionsOnly} onClick={() => setCaptionsOnly((value) => !value)}><Captions size={13} aria-hidden /> <span>С текстом</span></FilterChip>
          </FilterGroup>
          <FilterGroup label="Быстрые темы">
            {QUICK_TOPICS.map((topic) => <FilterChip key={topic} active={submittedSearch.toLowerCase() === topic.toLowerCase()} onClick={() => chooseQuickTopic(topic)}>{topic}</FilterChip>)}
          </FilterGroup>
          <button type="button" className="videos-filter-apply" onClick={() => void loadVideos(0, false)}>Применить фильтры</button>
        </div>
      )}

      <div className="videos-count-row">
        <span className="videos-count-text">{isLoading ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Loader2 size={13} className="spin" /> Ищем новые видео на YouTube…</span> : `Найдено видео: ${videos.length}`}</span>
        {(activeFilterCount > 0 || submittedSearch) && <button type="button" className="videos-reset-filters-btn" onClick={resetFilters}>Сбросить</button>}
      </div>

      {aiApplied && intent && <div className="videos-search-note"><Sparkles size={13} /> AI понял запрос как: «{intent.keywords}»{intent.cefrLevel !== "all" ? ` · ${intent.cefrLevel}` : ""}{intent.captionsOnly ? " · с текстом" : ""}</div>}
      {warning && <div className="videos-search-warning" role="status">{warning}</div>}
      {error && <div className="videos-search-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadVideos(0, false)}>Повторить</button></div>}

      {!isLoading && !error && (() => {
        const visibleVideos = collection === "favorites" ? favorites : collection === "history" ? history : videos;
        return visibleVideos.length > 0
          ? <div className="videos-grid">{visibleVideos.map((video) => <VideoCard key={video.youtubeId} video={video} onSelect={selectVideo} progressPercent={progress[video.youtubeId]?.percent} isFavorite={favorites.some((item) => item.youtubeId === video.youtubeId)} onToggleFavorite={toggleFavorite} />)}</div>
          : <div className="seed-card videos-empty"><p>{collection === "favorites" ? "Здесь появятся видео, которые вы сохраните." : collection === "history" ? "История просмотров пока пуста." : "Ничего не найдено. Уберите один из фильтров или попробуйте другую формулировку."}</p></div>;
      })()}

      {nextPage !== null && !error && <div className="videos-load-more"><button type="button" className="videos-search-submit-btn" onClick={() => void loadVideos(nextPage, true)} disabled={isLoadingMore}>{isLoadingMore ? <><Loader2 size={14} className="spin" /> Ищем ещё…</> : "Показать ещё"}</button></div>}

      {activeVideo && <VideoPlayerModal video={activeVideo} profile={profile} userId={userId} onClose={() => setActiveVideo(null)} onAddCard={onAddCard} onProgress={(current, duration, cueIndex, cueText) => {
        const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
        setProgress((previous) => ({ ...previous, [activeVideo.youtubeId]: { percent, position: current, maxPosition: Math.max(previous[activeVideo.youtubeId]?.maxPosition || 0, current) } }));
        if (userId) void sbUpsertVideoLibrary({ user_id: userId, video: activeVideo, is_favorite: favorites.some((item) => item.youtubeId === activeVideo.youtubeId), last_position_seconds: current, max_position_seconds: Math.max(progress[activeVideo.youtubeId]?.maxPosition || 0, current), progress_percent: percent, last_cue_index: cueIndex, last_cue_text: cueText });
      }} />}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="filter-group"><div className="filter-group-label">{label}</div><div className="filter-chips">{children}</div></div>;
}

function FilterChip({ active, children, onClick, className = "" }: { active: boolean; children: React.ReactNode; onClick: () => void; className?: string }) {
  return <button type="button" className={`filter-chip ${className} ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

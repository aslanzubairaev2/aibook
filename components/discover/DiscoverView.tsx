"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X, BookOpen,
  GraduationCap, Server, Loader2, BookMarked,
  Sparkles, CheckCircle2, PlayCircle, Clock, Circle,
} from "lucide-react";
import type { Book, LessonContext } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";

type Props = {
  books: Book[];
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  languages: string[];
  formats: Record<string, string>;
};

type GutendexResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
};

type DownloadTask = {
  progress: number;
  status: "downloading" | "parsing" | "saving" | "done" | "error";
  message: string;
  bookLocalId?: string;
};

type SharedBook = {
  id: string;
  title: string;
  author: string | null;
  language: string;
  cefr_level: string | null;
  source_type: string;
  source_id: string | null;
  course_id: string | null;
  course_title: string | null;
  lesson_order: number | null;
  cover_url: string | null;
  total_chars: number;
  metadata: { description?: string; cover_color?: string; [key: string]: unknown };
  created_at: string;
};

type LessonProgressMap = Record<string, {
  status: "not_started" | "in_progress" | "completed";
  percentage: number;
  paragraph_index: number;
}>;

const PAGE_SIZE = 18;

const LANGUAGES = [
  { value: "", label: "Все языки" },
  { value: "en", label: "Английский" },
  { value: "de", label: "Немецкий" },
  { value: "fr", label: "Французский" },
  { value: "es", label: "Испанский" },
  { value: "it", label: "Итальянский" },
  { value: "ru", label: "Русский" },
];

const COVER_COLORS = [
  "linear-gradient(160deg, #c49a28 0%, #7a5c10 100%)",
  "linear-gradient(160deg, #4a7a5c 0%, #254030 100%)",
  "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)",
  "linear-gradient(160deg, #8a3a3a 0%, #4a1a1a 100%)",
  "linear-gradient(160deg, #6a3a8a 0%, #35174a 100%)",
  "linear-gradient(160deg, #8a5a2a 0%, #4a2a0a 100%)",
];

const CEFR_COLORS: Record<string, string> = {
  A1: "#4caf50", A2: "#8bc34a", B1: "#2196f3", B2: "#03a9f4", C1: "#9c27b0", C2: "#673ab7",
};

function pickColor(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

function getCoverUrl(book: GutendexBook) {
  const coverKey = Object.keys(book.formats).find((key) => key.startsWith("image/jpeg"));
  return coverKey ? book.formats[coverKey].replace("http://", "https://").replace(".medium.", ".small.") : null;
}

function hasText(book: GutendexBook) {
  return Object.keys(book.formats).some((key) => key.startsWith("text/plain"));
}

function buildCatalogUrl(searchQuery: string, language: string, page: number) {
  const params = new URLSearchParams({ sort: "popular", page: String(page), page_size: String(PAGE_SIZE) });
  if (searchQuery.trim()) params.set("search", searchQuery.trim());
  if (language) params.set("languages", language);
  return `https://gutendex.com/books/?${params.toString()}`;
}

// Groups shared books by CEFR level
function groupByCefr(books: SharedBook[]): Array<{ level: string; levelTitle: string; color: string; books: SharedBook[] }> {
  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const levelTitles: Record<string, string> = {
    A1: "Уровень A1 (Начальный)", A2: "Уровень A2 (Элементарный)",
    B1: "Уровень B1 (Пороговый)", B2: "Уровень B2 (Средний)",
    C1: "Уровень C1 (Продвинутый)", C2: "Уровень C2 (Мастерство)",
  };
  const map = new Map<string, SharedBook[]>();
  for (const b of books) {
    const lvl = b.cefr_level ?? "—";
    if (!map.has(lvl)) map.set(lvl, []);
    map.get(lvl)!.push(b);
  }
  // Within a level: group by language, then natural title order ("текст 2" < "текст 10")
  const byTitle = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
  for (const list of map.values()) {
    list.sort((a, b) =>
      (a.language ?? "").localeCompare(b.language ?? "") || byTitle.compare(a.title, b.title)
    );
  }
  return order
    .filter((lvl) => map.has(lvl))
    .map((lvl) => ({
      level: lvl,
      levelTitle: levelTitles[lvl] ?? lvl,
      color: CEFR_COLORS[lvl] ?? "#888",
      books: map.get(lvl)!,
    }));
}

const PREFS_KEY = "aibook:discover:prefs";

type DiscoverPrefs = {
  activeTab?: "classic" | "wikibooks" | "cefr";
  language?: string;
  cefrLangFilter?: string;
  cefrLevelFilter?: string;
  wikiLevelFilter?: string;
  wikiStatusFilter?: string;
  cefrStatusFilter?: string;
  collapsedLevels?: string[];
};

function readPrefs(): DiscoverPrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as DiscoverPrefs;
  } catch {
    return {};
  }
}

export function DiscoverView({ books, onBooksChange, onOpenBook, downloadTasks, onDownloadBook }: Props) {
  const { user } = useAuth();
  const [prefs] = useState<DiscoverPrefs>(readPrefs);
  const [activeTab, setActiveTab] = useState<"classic" | "wikibooks" | "cefr">(prefs.activeTab ?? "classic");

  // Gutenberg States
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [language, setLanguage] = useState(prefs.language ?? "");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [results, setResults] = useState<GutendexBook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared books state
  const [wikibooksBooks, setWikibooksBooks] = useState<SharedBook[]>([]);
  const [cefrBooks, setCefrBooks] = useState<SharedBook[]>([]);
  const [isSharedLoading, setIsSharedLoading] = useState(false);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressMap>({});
  const [openingLesson, setOpeningLesson] = useState<string | null>(null); // sharedBookId being loaded

  // Filters for CEFR tab
  const [cefrLangFilter, setCefrLangFilter] = useState(prefs.cefrLangFilter ?? "");
  const [cefrLevelFilter, setCefrLevelFilter] = useState(prefs.cefrLevelFilter ?? "");
  const [cefrStatusFilter, setCefrStatusFilter] = useState(prefs.cefrStatusFilter ?? "");

  // Filters for Wikibooks tab
  const [wikiLevelFilter, setWikiLevelFilter] = useState(prefs.wikiLevelFilter ?? "");
  const [wikiStatusFilter, setWikiStatusFilter] = useState(prefs.wikiStatusFilter ?? "");

  // Collapsible level sections (keys like "wikibooks:A1")
  const [collapsedLevels, setCollapsedLevels] = useState<Set<string>>(
    () => new Set(prefs.collapsedLevels ?? [])
  );
  const toggleLevel = useCallback((key: string) => {
    setCollapsedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Seeding States
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedProgress, setSeedProgress] = useState(0);
  const [seedMessage, setSeedMessage] = useState("");
  const [seedError, setSeedError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const isSearching = query.trim() !== submittedQuery.trim();

  // ── Load shared books ────────────────────────────────────────────────────────
  const loadSharedBooks = useCallback(async () => {
    setIsSharedLoading(true);
    try {
      const [wikiRes, cefrRes] = await Promise.all([
        freshFetch("/api/shared-books?source_type=wikibooks"),
        freshFetch("/api/shared-books?source_type=universal_cefr"),
      ]);
      if (wikiRes.ok) {
        const data = await wikiRes.json() as { books: SharedBook[] };
        setWikibooksBooks(data.books ?? []);
      }
      if (cefrRes.ok) {
        const data = await cefrRes.json() as { books: SharedBook[] };
        setCefrBooks(data.books ?? []);
      }
    } catch (err) {
      console.error("loadSharedBooks:", err);
    } finally {
      setIsSharedLoading(false);
    }
  }, []);

  // ── Load lesson progress ─────────────────────────────────────────────────────
  const loadLessonProgress = useCallback(async () => {
    if (!user) return;
    try {
      const res = await freshFetch("/api/lesson-progress", { headers: await sbAuthHeaders() });
      if (res.ok) {
        const data = await res.json() as { progress: Array<{ shared_book_id: string; status: string; percentage: number; paragraph_index: number }> };
        const map: LessonProgressMap = {};
        for (const p of data.progress ?? []) {
          map[p.shared_book_id] = {
            status: p.status as LessonProgressMap[string]["status"],
            percentage: Number(p.percentage),
            paragraph_index: p.paragraph_index,
          };
        }
        setLessonProgress(map);
      }
    } catch (err) {
      console.error("loadLessonProgress:", err);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "wikibooks" || activeTab === "cefr") {
      void loadSharedBooks();
      void loadLessonProgress();
    }
  }, [activeTab, loadSharedBooks, loadLessonProgress]);

  // Persist tab + filters + collapsed sections
  useEffect(() => {
    const data: DiscoverPrefs = {
      activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter,
      wikiLevelFilter, wikiStatusFilter, collapsedLevels: Array.from(collapsedLevels),
    };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter, wikiLevelFilter, wikiStatusFilter, collapsedLevels]);

  // ── Gutenberg auto-search ────────────────────────────────────────────────────
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = query.trim();
      if (nextQuery !== submittedQuery) {
        setSubmittedQuery(nextQuery);
        setPage(1);
      }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [query, submittedQuery]);

  useEffect(() => {
    if (activeTab !== "classic") return;
    const controller = new AbortController();
    async function fetchBooks() {
      setIsLoading(true);
      setError(null);
      const url = buildCatalogUrl(submittedQuery, language, page);
      const cacheKey = `aibook:catalog:${url}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached) as GutendexResponse;
          setResults(cachedData.results.filter(hasText).slice(0, PAGE_SIZE));
          setCount(cachedData.count);
        } else {
          setResults([]);
        }
      } catch { localStorage.removeItem(cacheKey); }
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error("Ошибка при загрузке каталога");
        const data = (await res.json()) as GutendexResponse;
        setResults(data.results.filter(hasText).slice(0, PAGE_SIZE));
        setCount(data.count);
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      } finally {
        setIsLoading(false);
      }
    }
    void fetchBooks();
    return () => controller.abort();
  }, [submittedQuery, language, page, activeTab]);

  const titleSet = useMemo(() => new Set(books.map((book) => book.title.toLowerCase())), [books]);

  // ── Open a shared lesson ─────────────────────────────────────────────────────
  const openSharedLesson = useCallback(async (sharedBook: SharedBook, courseBooks: SharedBook[]) => {
    setOpeningLesson(sharedBook.id);
    try {
      const res = await freshFetch(`/api/shared-books/${sharedBook.id}/chapters`);
      const data = await res.json() as { paragraphs: string[] };
      const paragraphs = data.paragraphs ?? [];
      if (paragraphs.length === 0) {
        alert("Текст урока пока недоступен. Запустите импорт учебной программы.");
        return;
      }

      const progress = lessonProgress[sharedBook.id];
      const courseIdx = courseBooks.findIndex((b) => b.id === sharedBook.id);
      const prevBook = courseIdx > 0 ? courseBooks[courseIdx - 1] : undefined;
      const nextBook = courseIdx < courseBooks.length - 1 ? courseBooks[courseIdx + 1] : undefined;

      const lessonContext: LessonContext = {
        courseId: sharedBook.course_id ?? "standalone",
        courseTitle: sharedBook.course_title ?? "Учебные материалы",
        sharedBookId: sharedBook.id,
        lessonOrder: sharedBook.lesson_order ?? courseIdx,
        totalLessons: courseBooks.length,
        prevLesson: prevBook ? { sharedBookId: prevBook.id, title: prevBook.title } : undefined,
        nextLesson: nextBook ? { sharedBookId: nextBook.id, title: nextBook.title } : undefined,
      };

      const book: Book = {
        id: sharedBook.id,
        title: sharedBook.title,
        author: sharedBook.author ?? "Wikibooks",
        language: sharedBook.language,
        format: "txt",
        progress: progress?.percentage ?? 0,
        paragraphIndex: progress?.paragraph_index ?? 0,
        chapterTitle: sharedBook.title,
        lastReadAt: new Date().toLocaleDateString("ru"),
        coverColor: (sharedBook.metadata?.cover_color as string) ?? pickColor(sharedBook.title),
        coverUrl: sharedBook.cover_url,
        paragraphs,
        cefrLevel: (sharedBook.cefr_level as Book["cefrLevel"]) ?? null,
        sourceType: sharedBook.source_type as Book["sourceType"],
        sharedBookId: sharedBook.id,
        lessonContext,
      };

      onOpenBook(book);
    } catch (err) {
      console.error("openSharedLesson:", err);
      alert("Не удалось загрузить урок.");
    } finally {
      setOpeningLesson(null);
    }
  }, [lessonProgress, onOpenBook]);

  function submitSearch() { setSubmittedQuery(query.trim()); setPage(1); }
  function clearSearch() { setQuery(""); setSubmittedQuery(""); setPage(1); }

  // ── Seed import ──────────────────────────────────────────────────────────────
  const startImport = async (type: "wikibooks" | "cefr" = "wikibooks") => {
    setIsSeeding(true);
    setSeedProgress(5);
    setSeedMessage("Инициализация импорта...");
    setSeedError(null);
    try {
      const res = await fetch(`/api/books/seed?type=${type}`, { headers: await sbAuthHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `Ошибка импорта (${res.status})`);
      }
      if (!res.body) throw new Error("Поток пуст");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.replace("data: ", "").trim()) as { error?: string; progress?: number; message?: string };
              if (data.error) { setSeedError(data.error); setIsSeeding(false); return; }
              if (data.progress !== undefined) setSeedProgress(data.progress);
              if (data.message) setSeedMessage(data.message);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsSeeding(false);
      await loadSharedBooks();
      await loadLessonProgress();
    }
  };

  const matchStatus = useCallback((bookId: string, filter: string) => {
    if (!filter) return true;
    const status = lessonProgress[bookId]?.status ?? "not_started";
    return status === filter;
  }, [lessonProgress]);

  // ── Wikibooks syllabus ────────────────────────────────────────────────────────
  const filteredWikibooks = useMemo(() => {
    return wikibooksBooks.filter((b) => {
      if (wikiLevelFilter && b.cefr_level !== wikiLevelFilter) return false;
      if (!matchStatus(b.id, wikiStatusFilter)) return false;
      return true;
    });
  }, [wikibooksBooks, wikiLevelFilter, wikiStatusFilter, matchStatus]);
  const wikibooksGrouped = useMemo(() => groupByCefr(filteredWikibooks), [filteredWikibooks]);

  // ── Filtered CEFR texts ──────────────────────────────────────────────────────
  const filteredCefrBooks = useMemo(() => {
    return cefrBooks.filter((b) => {
      if (cefrLangFilter && b.language !== cefrLangFilter) return false;
      if (cefrLevelFilter && b.cefr_level !== cefrLevelFilter) return false;
      if (!matchStatus(b.id, cefrStatusFilter)) return false;
      return true;
    });
  }, [cefrBooks, cefrLangFilter, cefrLevelFilter, cefrStatusFilter, matchStatus]);
  const cefrGrouped = useMemo(() => groupByCefr(filteredCefrBooks), [filteredCefrBooks]);

  const completedWikibooks = useMemo(() =>
    wikibooksBooks.filter((b) => lessonProgress[b.id]?.status === "completed").length,
    [wikibooksBooks, lessonProgress]
  );

  return (
    <section className="screen discover-screen">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="screen-header">
        <div>
          <p className="eyebrow">Каталог материалов</p>
          <h1>Открытая библиотека</h1>
        </div>
      </header>

      {/* 4-tab navigation */}
      <div className="discover-tabs">
        {(["classic", "wikibooks", "cefr"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`discover-tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "classic" && <><BookOpen size={15} />Классика</>}
            {tab === "wikibooks" && <><GraduationCap size={15} />Wikibooks</>}
            {tab === "cefr" && <><BookMarked size={15} />CEFR тексты</>}
          </button>
        ))}
      </div>

      {/* ── Classic (Gutenberg) ─────────────────────────────────────────────── */}
      {activeTab === "classic" && (
        <>
          <div className="discover-toolbar">
            <div className="discover-search">
              <Search size={18} aria-hidden />
              <input
                type="text"
                placeholder="Название, автор, тема"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); if (e.key === "Escape") clearSearch(); }}
              />
              {query && <button type="button" className="discover-clear" onClick={clearSearch} aria-label="Очистить"><X size={16} /></button>}
            </div>
            <button type="button" className="pill-btn discover-submit" onClick={submitSearch}>Найти</button>
            <div className={`discover-language${language ? " filter-active" : ""}`}>
              {language && <span className="filter-lamp" aria-hidden />}
              <select value={language} onChange={(e) => { setLanguage(e.target.value); setPage(1); }} aria-label="Язык">
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden />
            </div>
          </div>
          {error && <div className="inline-error">{error}</div>}
          {isLoading && <div className="catalog-loading-inline"><span className="loading-dot" /><span>Загружаю каталог...</span></div>}
          <div className="discover-meta">
            <span>{isSearching ? "Уточняю поиск..." : `${count || results.length} книг`}</span>
            <span>Страница {page} из {totalPages}</span>
          </div>
          {isLoading && results.length === 0 ? (
            <CatalogSkeleton />
          ) : results.length === 0 ? (
            <div className="empty-state"><Globe size={40} /><strong>Книги не найдены</strong><p>Попробуйте другой запрос или язык</p></div>
          ) : (
            <>
              <div className={`discover-grid${isLoading ? " is-refreshing" : ""}`}>
                {results.map((bookInfo) => {
                  const coverUrl = getCoverUrl(bookInfo);
                  const isInLibrary = titleSet.has(bookInfo.title.toLowerCase());
                  return (
                    <button key={bookInfo.id} type="button" className="catalog-book" onClick={() => setSelectedBook(bookInfo)}>
                      <span className="catalog-cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : { background: pickColor(bookInfo.title) }}>
                        {!coverUrl && (bookInfo.languages?.[0] || "en").toUpperCase()}
                      </span>
                      <span className="catalog-book-body">
                        <strong>{bookInfo.title}</strong>
                        <span>{bookInfo.authors?.[0]?.name || "Неизвестен"}</span>
                        {isInLibrary && <em>В библиотеке</em>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="pager">
                <button type="button" className="mini-btn" disabled={page <= 1 || isLoading} onClick={() => setPage((v) => Math.max(1, v - 1))}>
                  <ChevronLeft size={15} />Назад
                </button>
                <span>{page} / {totalPages}</span>
                <button type="button" className="mini-btn" disabled={page >= totalPages || isLoading} onClick={() => setPage((v) => v + 1)}>
                  Вперёд<ChevronRight size={15} />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Wikibooks German Course ─────────────────────────────────────────── */}
      {activeTab === "wikibooks" && (
        <>
          <div className="discover-meta" style={{ marginBottom: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} style={{ color: "var(--accent)" }} />
              {wikibooksBooks.length > 0
                ? `${filteredWikibooks.length} из ${wikibooksBooks.length} • ${completedWikibooks} пройдено`
                : "Учебная программа не загружена"}
            </span>
            <button type="button" className="mini-btn" onClick={() => void startImport()} style={{ gap: 4, height: 26, fontSize: 11 }}>
              {wikibooksBooks.length > 0 ? "Обновить" : "Загрузить программу"}
            </button>
          </div>

          {wikibooksBooks.length > 0 && (
            <div className="discover-toolbar" style={{ gridTemplateColumns: "1fr 1fr auto", marginBottom: 16, alignItems: "center" }}>
              <div className={`discover-language${wikiLevelFilter ? " filter-active" : ""}`}>
                {wikiLevelFilter && <span className="filter-lamp" aria-hidden />}
                <select value={wikiLevelFilter} onChange={(e) => setWikiLevelFilter(e.target.value)} aria-label="Уровень CEFR">
                  <option value="">Все уровни</option>
                  {["A1","A2","B1","B2","C1","C2"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <ChevronDown size={15} aria-hidden />
              </div>
              <div className={`discover-language${wikiStatusFilter ? " filter-active" : ""}`}>
                {wikiStatusFilter && <span className="filter-lamp" aria-hidden />}
                <select value={wikiStatusFilter} onChange={(e) => setWikiStatusFilter(e.target.value)} aria-label="Статус">
                  <option value="">Любой статус</option>
                  <option value="not_started">Не начатые</option>
                  <option value="in_progress">В процессе</option>
                  <option value="completed">Пройденные</option>
                </select>
                <ChevronDown size={15} aria-hidden />
              </div>
              {(wikiLevelFilter || wikiStatusFilter) && (
                <button type="button" className="filter-reset-btn" onClick={() => { setWikiLevelFilter(""); setWikiStatusFilter(""); }} title="Сбросить фильтры">
                  <X size={13} />Сброс
                </button>
              )}
            </div>
          )}

          {isSharedLoading ? (
            <div className="catalog-loading-inline" style={{ justifyContent: "center", padding: "40px 0" }}>
              <Loader2 className="spin" size={24} /><span>Загрузка уроков...</span>
            </div>
          ) : wikibooksBooks.length === 0 ? (
            <div className="seed-card">
              <Server size={42} style={{ color: "var(--accent)" }} />
              <h3>Программа Wikibooks не установлена</h3>
              <p>Нажмите кнопку ниже, чтобы скачать уроки немецкого A1–B2 из открытого учебника Wikibooks. Контент загружается один раз для всех пользователей.</p>
              <button type="button" className="seed-btn" onClick={() => void startImport()}>
                <Server size={15} />Загрузить учебную программу
              </button>
            </div>
          ) : wikibooksGrouped.length === 0 ? (
            <div className="empty-state"><Globe size={40} /><strong>Ничего не найдено</strong><p>Измените фильтры</p></div>
          ) : (
            <>
              {wikibooksGrouped.map((group) => {
                const key = `wikibooks:${group.level}`;
                const collapsed = collapsedLevels.has(key);
                const done = group.books.filter((b) => lessonProgress[b.id]?.status === "completed").length;
                return (
                  <LevelSection
                    key={group.level}
                    levelTitle={group.levelTitle}
                    headerStyle={{ background: group.color }}
                    counterText={`${done} / ${group.books.length} пройдено`}
                    collapsed={collapsed}
                    onToggle={() => toggleLevel(key)}
                  >
                    {group.books.map((sb) => (
                      <SyllabusItem
                        key={sb.id}
                        book={sb}
                        progress={lessonProgress[sb.id]}
                        isLoading={openingLesson === sb.id}
                        onOpen={() => void openSharedLesson(sb, filteredWikibooks)}
                      />
                    ))}
                  </LevelSection>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── CEFR Texts (UniversalCEFR) ──────────────────────────────────────── */}
      {activeTab === "cefr" && (
        <>
          <div className="discover-toolbar" style={{ gridTemplateColumns: "1fr 1fr 1fr auto", marginBottom: 16, alignItems: "center" }}>
            <div className={`discover-language${cefrLangFilter ? " filter-active" : ""}`}>
              {cefrLangFilter && <span className="filter-lamp" aria-hidden />}
              <select value={cefrLangFilter} onChange={(e) => setCefrLangFilter(e.target.value)} aria-label="Язык">
                <option value="">Все языки</option>
                <option value="de">Немецкий</option>
                <option value="en">Английский</option>
                <option value="fr">Французский</option>
                <option value="es">Испанский</option>
              </select>
              <ChevronDown size={15} aria-hidden />
            </div>
            <div className={`discover-language${cefrLevelFilter ? " filter-active" : ""}`}>
              {cefrLevelFilter && <span className="filter-lamp" aria-hidden />}
              <select value={cefrLevelFilter} onChange={(e) => setCefrLevelFilter(e.target.value)} aria-label="Уровень CEFR">
                <option value="">Все уровни</option>
                {["A1","A2","B1","B2","C1","C2"].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden />
            </div>
            <div className={`discover-language${cefrStatusFilter ? " filter-active" : ""}`}>
              {cefrStatusFilter && <span className="filter-lamp" aria-hidden />}
              <select value={cefrStatusFilter} onChange={(e) => setCefrStatusFilter(e.target.value)} aria-label="Статус">
                <option value="">Любой статус</option>
                <option value="not_started">Не начатые</option>
                <option value="in_progress">В процессе</option>
                <option value="completed">Пройденные</option>
              </select>
              <ChevronDown size={15} aria-hidden />
            </div>
            {(cefrLangFilter || cefrLevelFilter || cefrStatusFilter) && (
              <button
                type="button"
                className="filter-reset-btn"
                onClick={() => { setCefrLangFilter(""); setCefrLevelFilter(""); setCefrStatusFilter(""); }}
                title="Сбросить фильтры"
              >
                <X size={13} />Сброс
              </button>
            )}
          </div>

          <div className="discover-meta" style={{ marginBottom: 12 }}>
            <span>{cefrBooks.length > 0 ? `${filteredCefrBooks.length} текстов` : "Тексты не загружены"}</span>
            <button type="button" className="mini-btn" onClick={() => void startImport("cefr")} style={{ gap: 4, height: 26, fontSize: 11 }}>
              {cefrBooks.length > 0 ? "Обновить" : "Загрузить тексты"}
            </button>
          </div>

          {isSharedLoading ? (
            <div className="catalog-loading-inline" style={{ justifyContent: "center", padding: "40px 0" }}>
              <Loader2 className="spin" size={24} /><span>Загрузка...</span>
            </div>
          ) : cefrBooks.length === 0 ? (
            <div className="seed-card">
              <BookMarked size={42} style={{ color: "var(--accent)" }} />
              <h3>Тексты UniversalCEFR не загружены</h3>
              <p>Загрузите академические тексты с разметкой CEFR A1–C1 на английском и немецком.</p>
              <button type="button" className="seed-btn" onClick={() => void startImport("cefr")}>
                <BookMarked size={15} />Загрузить тексты CEFR
              </button>
            </div>
          ) : cefrGrouped.length === 0 ? (
            <div className="empty-state"><Globe size={40} /><strong>Ничего не найдено</strong><p>Измените фильтры</p></div>
          ) : (
            cefrGrouped.map((group) => {
              const key = `cefr:${group.level}`;
              const collapsed = collapsedLevels.has(key);
              const done = group.books.filter((b) => lessonProgress[b.id]?.status === "completed").length;
              return (
                <LevelSection
                  key={group.level}
                  levelTitle={group.levelTitle}
                  headerStyle={{ background: "rgba(240,230,211,0.08)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                  counterText={`${done} / ${group.books.length}`}
                  timelineStyle={{ borderLeftColor: "rgba(240,230,211,0.15)" }}
                  collapsed={collapsed}
                  onToggle={() => toggleLevel(key)}
                >
                  {group.books.map((sb) => (
                    <SyllabusItem
                      key={sb.id}
                      book={sb}
                      progress={lessonProgress[sb.id]}
                      isLoading={openingLesson === sb.id}
                      showLang
                      onOpen={() => void openSharedLesson(sb, filteredCefrBooks)}
                    />
                  ))}
                </LevelSection>
              );
            })
          )}
        </>
      )}

      {/* Gutenberg modal */}
      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          coverUrl={getCoverUrl(selectedBook)}
          coverColor={pickColor(selectedBook.title)}
          inLibrary={books.some((b) => b.title.toLowerCase() === selectedBook.title.toLowerCase())}
          downloadTask={downloadTasks[selectedBook.id]}
          isDownloading={["downloading","parsing","saving"].includes(downloadTasks[selectedBook.id]?.status)}
          onClose={() => setSelectedBook(null)}
          onDownload={() => onDownloadBook(selectedBook)}
          onOpen={() => {
            const existing = books.find((b) => b.title.toLowerCase() === selectedBook.title.toLowerCase());
            if (existing) { onOpenBook(existing); setSelectedBook(null); }
          }}
        />
      )}

      {/* Seed progress modal */}
      {isSeeding && (
        <div className="seed-modal-backdrop">
          <div className="seed-modal">
            <Loader2 className="spin" size={32} style={{ color: "var(--accent)", margin: "0 auto 12px" }} />
            <h3>Импорт учебных материалов</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 16px" }}>
              Загружаем уроки Wikibooks и тексты UniversalCEFR. Контент сохраняется для всех пользователей...
            </p>
            <div className="seed-progress-bar-wrap">
              <div className="seed-progress-bar" style={{ width: `${seedProgress}%` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
              <span>Прогресс</span><span>{seedProgress}%</span>
            </div>
            <div className="seed-log">{seedMessage}</div>
            {seedError && <div className="inline-error" style={{ marginTop: 10 }}>{seedError}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Sub-component: Collapsible Level Section ─────────────────────────────────

type LevelSectionProps = {
  levelTitle: string;
  headerStyle?: CSSProperties;
  timelineStyle?: CSSProperties;
  counterText: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function LevelSection({ levelTitle, headerStyle, timelineStyle, counterText, collapsed, onToggle, children }: LevelSectionProps) {
  return (
    <div className="syllabus-level-section">
      <button type="button" className="syllabus-level-header syllabus-level-toggle" style={headerStyle} onClick={onToggle} aria-expanded={!collapsed}>
        <ChevronRight size={16} className="level-chevron" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.2s" }} />
        <span>{levelTitle}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.85 }}>{counterText}</span>
      </button>
      {!collapsed && (
        <div className="syllabus-timeline" style={timelineStyle}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Syllabus Item ─────────────────────────────────────────────

type SyllabusItemProps = {
  book: SharedBook;
  progress?: { status: "not_started" | "in_progress" | "completed"; percentage: number };
  isLoading: boolean;
  showLang?: boolean;
  onOpen: () => void;
};

function SyllabusItem({ book, progress, isLoading, showLang, onOpen }: SyllabusItemProps) {
  const status = progress?.status ?? "not_started";
  return (
    <div className={`syllabus-item ${status === "completed" ? "completed" : status === "in_progress" ? "active" : ""}`}>
      <span className="syllabus-node" style={{
        background: status === "completed" ? "#7aab6a" : status === "in_progress" ? "var(--accent)" : undefined,
        boxShadow: status !== "not_started" ? "0 0 8px currentColor" : undefined,
      }} />
      <div className="syllabus-meta">
        {showLang && <span>{book.language.toUpperCase()}</span>}
        {book.cefr_level && <span>{book.cefr_level}</span>}
        {showLang && <span>•</span>}
        <span>{book.source_type === "wikibooks" ? "Wikibooks" : "UniversalCEFR"}</span>
        {progress && progress.status !== "not_started" && (
          <span style={{ color: status === "completed" ? "#7aab6a" : "var(--accent)" }}>
            {status === "completed" ? "✓ Пройдено" : `${Math.round(progress.percentage)}%`}
          </span>
        )}
      </div>
      <h3 className="syllabus-title">{book.title}</h3>
      {book.metadata?.description && (
        <p className="syllabus-desc">{String(book.metadata.description)}</p>
      )}
      <div className="syllabus-action-row">
        <button
          type="button"
          className="mini-btn"
          disabled={isLoading}
          style={
            status === "completed"
              ? { background: "rgba(122,171,106,0.2)", color: "#7aab6a", border: "1px solid rgba(122,171,106,0.4)", gap: 4 }
              : status === "in_progress"
              ? { background: "rgba(212,168,71,0.15)", color: "var(--accent)", border: "1px solid rgba(212,168,71,0.3)", gap: 4 }
              : { background: "rgba(212,168,71,0.08)", color: "var(--accent)", gap: 4 }
          }
          onClick={onOpen}
        >
          {isLoading ? (
            <><Loader2 className="spin" size={13} />Загрузка...</>
          ) : status === "completed" ? (
            <><CheckCircle2 size={13} />Пройти заново</>
          ) : status === "in_progress" ? (
            <><Clock size={13} />Продолжить</>
          ) : (
            <><PlayCircle size={13} />Начать урок</>
          )}
        </button>
      </div>
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="discover-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="catalog-book catalog-book-skeleton">
          <span className="catalog-cover skeleton-block" />
          <span className="catalog-book-body">
            <span className="shimmer-line" />
            <span className="shimmer-line medium" />
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const STYLES = `
  .discover-tabs {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    background: rgba(39,35,25,0.92);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px;
    margin-bottom: 18px;
    gap: 4px;
  }
  .discover-tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    font-size: 12px;
    font-weight: 700;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    transition: all var(--transition-fast) cubic-bezier(0.4,0,0.2,1);
    cursor: pointer;
    white-space: nowrap;
  }
  .discover-tab-btn.active {
    background: var(--accent);
    color: var(--text-dark);
    box-shadow: 0 4px 12px rgba(212,168,71,0.22);
  }
  .discover-tab-btn:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(240,230,211,0.05);
  }
  .seed-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: rgba(39,35,25,0.44);
    backdrop-filter: blur(10px);
    margin: 20px 0;
  }
  .seed-card h3 { font-size: 18px; margin-top: 12px; margin-bottom: 8px; color: var(--text-primary); }
  .seed-card p { font-size: 13px; color: var(--text-muted); max-width: 380px; margin-bottom: 20px; line-height: 1.5; }
  .seed-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-weight: 700;
    font-size: 13px;
    background: var(--accent);
    color: var(--text-dark);
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: transform 0.2s;
  }
  .seed-btn:active { transform: scale(0.97); }
  .seed-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(12px);
    padding: 16px;
  }
  .seed-modal {
    width: 100%;
    max-width: 460px;
    background: rgba(30,27,22,0.96);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 24px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    text-align: center;
  }
  .seed-progress-bar-wrap {
    width: 100%;
    height: 8px;
    background: rgba(240,230,211,0.1);
    border-radius: 99px;
    margin: 20px 0 10px;
    overflow: hidden;
  }
  .seed-progress-bar {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent) 0%, #8bc34a 100%);
    transition: width 0.3s ease-out;
  }
  .seed-log {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-muted);
    background: rgba(20,18,16,0.7);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    margin-top: 14px;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .oersi-card {
    display: flex;
    flex-direction: column;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: rgba(39,35,25,0.62);
    text-align: left;
    box-shadow: 0 6px 16px rgba(0,0,0,0.18);
  }
  .oersi-card strong { font-size: 15px; color: var(--text-primary); line-height: 1.3; margin-bottom: 6px; }
  .oersi-card p { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .oersi-card em { font-size: 11px; color: var(--accent); font-style: normal; font-weight: 700; }
  .oersi-actions { display: flex; gap: 8px; margin-top: 12px; }
  .oersi-open-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid rgba(212,168,71,0.25);
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .oersi-open-btn:hover { background: rgba(212,168,71,0.06); }
  .oersi-import-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    font-size: 11px;
    font-weight: 700;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: var(--text-dark);
    cursor: pointer;
    transition: all 0.2s;
  }
  .oersi-import-btn:disabled { opacity: 0.5; }
  .syllabus-level-section { margin-bottom: 24px; text-align: left; }
  .syllabus-level-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 12px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
  }
  .syllabus-level-toggle {
    width: 100%;
    cursor: pointer;
    text-align: left;
    border: 0;
    font-family: inherit;
    transition: filter 0.2s;
  }
  .syllabus-level-toggle:hover { filter: brightness(1.08); }
  .syllabus-level-toggle .level-chevron { flex-shrink: 0; }
  .syllabus-timeline {
    position: relative;
    padding-left: 20px;
    border-left: 2px solid var(--border);
    margin-left: 10px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .syllabus-item {
    position: relative;
    background: rgba(39,35,25,0.54);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    transition: border-color 0.2s, background-color 0.2s;
  }
  .syllabus-item:hover { border-color: rgba(212,168,71,0.35); background: rgba(39,35,25,0.74); }
  .syllabus-item.active { border-color: rgba(212,168,71,0.2); }
  .syllabus-node {
    position: absolute;
    left: -27px;
    top: 18px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--border-strong);
    border: 2px solid var(--surface-dim);
    transition: background-color 0.2s;
  }
  .syllabus-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 800;
    color: var(--accent);
  }
  .syllabus-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
  .syllabus-desc { font-size: 12px; color: var(--text-muted); margin: 0 0 12px; line-height: 1.4; }
  .syllabus-action-row { width: 100%; display: flex; justify-content: flex-end; gap: 8px; }
  .syllabus-item.completed {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.10);
  }
  .syllabus-item.completed:hover {
    border-color: rgba(122,171,106,0.7);
    background: rgba(122,171,106,0.16);
  }
  .syllabus-item.completed .syllabus-node {
    border-color: rgba(122,171,106,0.5);
  }
  .discover-language.filter-active select {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .filter-lamp {
    position: absolute;
    left: 10px;
    top: 50%;
    width: 8px;
    height: 8px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent), 0 0 2px var(--accent);
    animation: filter-lamp-pulse 1.8s ease-in-out infinite;
    z-index: 2;
  }
  .discover-language.filter-active select { padding-left: 26px; }
  @keyframes filter-lamp-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  .filter-reset-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .filter-reset-btn:hover { color: var(--text-primary); border-color: var(--accent); }
`;

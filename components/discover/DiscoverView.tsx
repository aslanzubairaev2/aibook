"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X, BookOpen,
  GraduationCap, Server, Loader2, BookMarked,
  Sparkles, CheckCircle2, PlayCircle, Clock, Circle,
  Wand2, Trash2, ExternalLink, Info, Mic, MicOff, Pencil,
} from "lucide-react";
import type { Book, LessonContext, CefrLevel, Flashcard, UserProfile } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { freshFetch } from "@/lib/net/freshFetch";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import { startRecognition, isSpeechRecognitionSupported, type Recognizer } from "@/lib/speech/recognition";

type Props = {
  books: Book[];
  cards: Flashcard[];
  profile: UserProfile;
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
  metadata: {
    description?: string;
    cover_color?: string;
    /** Klexikon: link back to the article + its CC licence (attribution). */
    source_url?: string;
    license?: string;
    /** Klexikon: the CEFR level is a readability estimate, not a human rating. */
    level_estimated?: boolean;
    [key: string]: unknown;
  };
  created_at: string;
};

// Each tab is one source, described in its own words so it is obvious what the
// content is and where it came from.
type TabKey = "classic" | "klexikon" | "cefr" | "lessons";

const TAB_INFO: Record<TabKey, { label: string; source: string; note: string }> = {
  classic: {
    label: "Классика",
    source: "Project Gutenberg",
    note: "Книги, перешедшие в общественное достояние. Оригинальные тексты без адаптации под уровень.",
  },
  klexikon: {
    label: "Клексикон",
    source: "klexikon.zum.de · CC BY-SA",
    note: "Немецкая детская энциклопедия: настоящий немецкий, но короткими предложениями и простыми словами. Уровень — оценка по читаемости текста, не экспертная разметка.",
  },
  cefr: {
    label: "CEFR тексты",
    source: "UniversalCEFR (HuggingFace)",
    note: "Открытый корпус текстов с проставленными уровнями A1–C1. Уровень задан в самом датасете.",
  },
  lessons: {
    label: "Мои уроки",
    source: "Генерация ИИ",
    note: "Текст пишется под ваш уровень и вашу тему, с вплетёнными словами из ваших карточек. Виден только вам.",
  },
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
  activeTab?: TabKey;
  language?: string;
  cefrLangFilter?: string;
  cefrLevelFilter?: string;
  klexLevelFilter?: string;
  klexStatusFilter?: string;
  klexikonOffset?: number;
  cefrStatusFilter?: string;
  collapsedLevels?: string[];
  lessonLevel?: CefrLevel;
  lessonLength?: "short" | "medium" | "long";
};

function readPrefs(): DiscoverPrefs {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as DiscoverPrefs;
    // Stored preferences outlive the code that wrote them: a returning user can
    // carry a tab name that no longer exists (e.g. the retired "wikibooks").
    // Dropping it here keeps every TAB_INFO lookup total.
    if (parsed.activeTab && !(parsed.activeTab in TAB_INFO)) {
      delete parsed.activeTab;
    }
    return parsed;
  } catch {
    return {};
  }
}

export function DiscoverView({ books, cards, profile, onBooksChange, onOpenBook, downloadTasks, onDownloadBook }: Props) {
  const { user } = useAuth();
  const [prefs] = useState<DiscoverPrefs>(readPrefs);
  const [activeTab, setActiveTab] = useState<TabKey>(prefs.activeTab ?? "classic");

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
  const [klexikonBooks, setKlexikonBooks] = useState<SharedBook[]>([]);
  const [cefrBooks, setCefrBooks] = useState<SharedBook[]>([]);
  const [myLessons, setMyLessons] = useState<SharedBook[]>([]);
  const [isSharedLoading, setIsSharedLoading] = useState(false);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressMap>({});
  const [openingLesson, setOpeningLesson] = useState<string | null>(null); // sharedBookId being loaded

  // Filters for CEFR tab
  const [cefrLangFilter, setCefrLangFilter] = useState(prefs.cefrLangFilter ?? "");
  const [cefrLevelFilter, setCefrLevelFilter] = useState(prefs.cefrLevelFilter ?? "");
  const [cefrStatusFilter, setCefrStatusFilter] = useState(prefs.cefrStatusFilter ?? "");

  // Filters for Klexikon tab
  const [klexLevelFilter, setKlexLevelFilter] = useState(prefs.klexLevelFilter ?? "");
  const [klexStatusFilter, setKlexStatusFilter] = useState(prefs.klexStatusFilter ?? "");
  const [klexQuery, setKlexQuery] = useState("");
  // Where the next Klexikon import batch should resume from (reported by the
  // seed route, persisted so it survives a reload).
  const [klexikonOffset, setKlexikonOffset] = useState(prefs.klexikonOffset ?? 0);

  // "Мои уроки" generator form
  const [lessonTopic, setLessonTopic] = useState("");
  const [lessonContext, setLessonContext] = useState("");
  const [lessonLevel, setLessonLevel] = useState<CefrLevel>(prefs.lessonLevel ?? "A2");
  const [lessonLength, setLessonLength] = useState<"short" | "medium" | "long">(prefs.lessonLength ?? "medium");
  const [useReviewWords, setUseReviewWords] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Revising an existing lesson: which one is open, and the notes for it.
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Collapsible level sections (keys like "klexikon:A1")
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
      const [klexRes, cefrRes] = await Promise.all([
        freshFetch("/api/shared-books?source_type=klexikon"),
        freshFetch("/api/shared-books?source_type=universal_cefr"),
      ]);
      if (klexRes.ok) {
        const data = await klexRes.json() as { books: SharedBook[] };
        setKlexikonBooks(data.books ?? []);
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

  // ── Load the caller's own generated lessons ──────────────────────────────────
  const loadMyLessons = useCallback(async () => {
    if (!user) { setMyLessons([]); return; }
    try {
      const res = await freshFetch("/api/lessons", { headers: await sbAuthHeaders() });
      if (res.ok) {
        const data = await res.json() as { lessons: SharedBook[] };
        setMyLessons(data.lessons ?? []);
      }
    } catch (err) {
      console.error("loadMyLessons:", err);
    }
  }, [user]);

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
    if (activeTab === "klexikon" || activeTab === "cefr") {
      void loadSharedBooks();
      void loadLessonProgress();
    }
    if (activeTab === "lessons") {
      void loadMyLessons();
      void loadLessonProgress();
    }
  }, [activeTab, loadSharedBooks, loadMyLessons, loadLessonProgress]);

  // Default the generator to the learner's estimated level, unless they have
  // already picked one themselves (which readPrefs restores).
  useEffect(() => {
    if (prefs.lessonLevel) return;
    let cancelled = false;
    void estimateTargetLanguageLevel(profile.targetLanguage).then((estimate) => {
      if (!cancelled && estimate) setLessonLevel(estimate.level);
    });
    return () => { cancelled = true; };
  }, [prefs.lessonLevel, profile.targetLanguage]);

  // Persist tab + filters + collapsed sections
  useEffect(() => {
    const data: DiscoverPrefs = {
      activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter,
      klexLevelFilter, klexStatusFilter, collapsedLevels: Array.from(collapsedLevels),
      lessonLevel, lessonLength, klexikonOffset,
    };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter, klexLevelFilter, klexStatusFilter, collapsedLevels, lessonLevel, lessonLength, klexikonOffset]);

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
      // Generated lessons are owner-scoped, so the chapters call needs the token.
      const res = await freshFetch(`/api/shared-books/${sharedBook.id}/chapters`, { headers: await sbAuthHeaders() });
      const data = await res.json() as { paragraphs: string[] };
      const paragraphs = data.paragraphs ?? [];
      if (paragraphs.length === 0) {
        alert("Текст пока недоступен. Запустите импорт материалов.");
        return;
      }

      const progress = lessonProgress[sharedBook.id];
      const courseIdx = courseBooks.findIndex((b) => b.id === sharedBook.id);
      const prevBook = courseIdx > 0 ? courseBooks[courseIdx - 1] : undefined;
      const nextBook = courseIdx < courseBooks.length - 1 ? courseBooks[courseIdx + 1] : undefined;

      const lessonContext: LessonContext = {
        courseId: sharedBook.course_id ?? "standalone",
        courseTitle: sharedBook.course_title ?? "Материалы",
        sharedBookId: sharedBook.id,
        lessonOrder: sharedBook.lesson_order ?? courseIdx,
        totalLessons: courseBooks.length,
        prevLesson: prevBook ? { sharedBookId: prevBook.id, title: prevBook.title } : undefined,
        nextLesson: nextBook ? { sharedBookId: nextBook.id, title: nextBook.title } : undefined,
      };

      const book: Book = {
        id: sharedBook.id,
        title: sharedBook.title,
        author: sharedBook.author ?? "Учебный материал",
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
  // Klexikon is imported in batches; `offset` resumes where the previous run
  // stopped, so repeated presses walk through the wiki instead of redoing it.
  const startImport = async (type: "klexikon" | "cefr", offset = 0) => {
    setIsSeeding(true);
    setSeedProgress(5);
    setSeedMessage("Инициализация импорта...");
    setSeedError(null);
    try {
      const res = await fetch(`/api/books/seed?type=${type}&offset=${offset}`, { headers: await sbAuthHeaders() });
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
              const data = JSON.parse(line.replace("data: ", "").trim()) as { error?: string; progress?: number; message?: string; nextOffset?: number };
              if (data.error) { setSeedError(data.error); setIsSeeding(false); return; }
              if (data.progress !== undefined) setSeedProgress(data.progress);
              if (data.message) setSeedMessage(data.message);
              if (data.nextOffset !== undefined) setKlexikonOffset(data.nextOffset);
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

  // ── Generate a lesson ────────────────────────────────────────────────────────
  // Words the SRS says are due now — feeding them to the generator is the whole
  // point of this tab: the text is built around what needs revising today.
  const dueReviewWords = useMemo(() => {
    const now = Date.now();
    return cards
      .filter((c) => c.type === "word" && new Date(c.dueAt).getTime() <= now)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 12)
      .map((c) => c.front);
  }, [cards]);

  const generateLesson = async () => {
    const topic = lessonTopic.trim();
    if (!topic || isGenerating) return;

    setIsGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          topic,
          context: lessonContext.trim(),
          level: lessonLevel,
          length: lessonLength,
          targetLanguage: profile.targetLanguage,
          nativeLanguage: profile.nativeLanguage,
          reviewWords: useReviewWords ? dueReviewWords : [],
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Ошибка генерации (${res.status})`);
      setLessonTopic("");
      await loadMyLessons();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsGenerating(false);
    }
  };

  const refineLesson = async (id: string) => {
    const instructions = refineText.trim();
    if (!instructions || isRefining) return;

    setIsRefining(true);
    setRefineError(null);
    try {
      const res = await fetch(`/api/lessons/${id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({ instructions }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Ошибка правки (${res.status})`);
      setRefineText("");
      setRefiningId(null);
      await loadMyLessons();
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsRefining(false);
    }
  };

  const openRefine = (id: string) => {
    setRefiningId((prev) => (prev === id ? null : id));
    setRefineText("");
    setRefineError(null);
  };

  const deleteLesson = async (id: string) => {
    if (!confirm("Удалить этот урок?")) return;
    try {
      const res = await fetch(`/api/lessons?id=${id}`, { method: "DELETE", headers: await sbAuthHeaders() });
      if (res.ok) setMyLessons((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error("deleteLesson:", err);
    }
  };

  const matchStatus = useCallback((bookId: string, filter: string) => {
    if (!filter) return true;
    const status = lessonProgress[bookId]?.status ?? "not_started";
    return status === filter;
  }, [lessonProgress]);

  // ── Klexikon articles ────────────────────────────────────────────────────────
  const filteredKlexikon = useMemo(() => {
    const q = klexQuery.trim().toLowerCase();
    return klexikonBooks.filter((b) => {
      if (klexLevelFilter && b.cefr_level !== klexLevelFilter) return false;
      if (!matchStatus(b.id, klexStatusFilter)) return false;
      if (q && !b.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [klexikonBooks, klexLevelFilter, klexStatusFilter, klexQuery, matchStatus]);
  const klexikonGrouped = useMemo(() => groupByCefr(filteredKlexikon), [filteredKlexikon]);

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

  const completedKlexikon = useMemo(() =>
    klexikonBooks.filter((b) => lessonProgress[b.id]?.status === "completed").length,
    [klexikonBooks, lessonProgress]
  );

  // Never index TAB_INFO directly with state that could have come from storage.
  const tabInfo = TAB_INFO[activeTab] ?? TAB_INFO.classic;

  // The tab row scrolls sideways, so a tab restored from preferences can sit
  // off-screen on load. Pull it into view. `nearest` on both axes means this is
  // a no-op when the tab is already visible, and never scrolls the page itself.
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  return (
    <section className="screen discover-screen">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="screen-header">
        <div>
          <p className="eyebrow">Каталог материалов</p>
          <h1>Открытая библиотека</h1>
        </div>
      </header>

      {/* One tab per source — the source note below spells out which is which */}
      <div className="discover-tabs">
        {(["classic", "klexikon", "cefr", "lessons"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            ref={activeTab === tab ? activeTabRef : undefined}
            className={`discover-tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "classic" && <BookOpen size={15} />}
            {tab === "klexikon" && <GraduationCap size={15} />}
            {tab === "cefr" && <BookMarked size={15} />}
            {tab === "lessons" && <Wand2 size={15} />}
            {TAB_INFO[tab].label}
          </button>
        ))}
      </div>

      <div className="source-note">
        <Info size={14} aria-hidden />
        <div>
          <strong>{tabInfo.source}</strong>
          <p>{tabInfo.note}</p>
        </div>
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

      {/* ── Klexikon (authentic German, CC BY-SA) ───────────────────────────── */}
      {activeTab === "klexikon" && (
        <>
          <div className="discover-meta" style={{ marginBottom: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} style={{ color: "var(--accent)" }} />
              {klexikonBooks.length > 0
                ? `${filteredKlexikon.length} из ${klexikonBooks.length} • ${completedKlexikon} прочитано`
                : "Статьи не загружены"}
            </span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => void startImport("klexikon", klexikonOffset)}
              style={{ gap: 4, height: 26, fontSize: 11 }}
            >
              {klexikonBooks.length > 0 ? "Загрузить ещё" : "Загрузить статьи"}
            </button>
          </div>

          {klexikonBooks.length > 0 && (
            <div className="discover-toolbar" style={{ gridTemplateColumns: "1fr 1fr 1fr auto", marginBottom: 16, alignItems: "center" }}>
              <div className="discover-search">
                <Search size={16} aria-hidden />
                <input
                  type="text"
                  placeholder="Тема статьи"
                  value={klexQuery}
                  onChange={(e) => setKlexQuery(e.target.value)}
                />
                {klexQuery && <button type="button" className="discover-clear" onClick={() => setKlexQuery("")} aria-label="Очистить"><X size={16} /></button>}
              </div>
              <div className={`discover-language${klexLevelFilter ? " filter-active" : ""}`}>
                {klexLevelFilter && <span className="filter-lamp" aria-hidden />}
                <select value={klexLevelFilter} onChange={(e) => setKlexLevelFilter(e.target.value)} aria-label="Уровень CEFR">
                  <option value="">Все уровни</option>
                  {["A1","A2","B1","B2","C1"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <ChevronDown size={15} aria-hidden />
              </div>
              <div className={`discover-language${klexStatusFilter ? " filter-active" : ""}`}>
                {klexStatusFilter && <span className="filter-lamp" aria-hidden />}
                <select value={klexStatusFilter} onChange={(e) => setKlexStatusFilter(e.target.value)} aria-label="Статус">
                  <option value="">Любой статус</option>
                  <option value="not_started">Не начатые</option>
                  <option value="in_progress">В процессе</option>
                  <option value="completed">Прочитанные</option>
                </select>
                <ChevronDown size={15} aria-hidden />
              </div>
              {(klexLevelFilter || klexStatusFilter || klexQuery) && (
                <button
                  type="button"
                  className="filter-reset-btn"
                  onClick={() => { setKlexLevelFilter(""); setKlexStatusFilter(""); setKlexQuery(""); }}
                  title="Сбросить фильтры"
                >
                  <X size={13} />Сброс
                </button>
              )}
            </div>
          )}

          {isSharedLoading ? (
            <div className="catalog-loading-inline" style={{ justifyContent: "center", padding: "40px 0" }}>
              <Loader2 className="spin" size={24} /><span>Загрузка статей...</span>
            </div>
          ) : klexikonBooks.length === 0 ? (
            <div className="seed-card">
              <Server size={42} style={{ color: "var(--accent)" }} />
              <h3>Статьи Клексикона не загружены</h3>
              <p>
                Клексикон — энциклопедия на немецком, написанная для детей: настоящий язык носителей,
                но короткими предложениями. Статьи загружаются партиями и сохраняются для всех пользователей.
              </p>
              <button type="button" className="seed-btn" onClick={() => void startImport("klexikon", 0)}>
                <Server size={15} />Загрузить статьи
              </button>
            </div>
          ) : klexikonGrouped.length === 0 ? (
            <div className="empty-state"><Globe size={40} /><strong>Ничего не найдено</strong><p>Измените фильтры</p></div>
          ) : (
            <>
              {klexikonGrouped.map((group) => {
                const key = `klexikon:${group.level}`;
                const collapsed = collapsedLevels.has(key);
                const done = group.books.filter((b) => lessonProgress[b.id]?.status === "completed").length;
                return (
                  <LevelSection
                    key={group.level}
                    levelTitle={`${group.levelTitle} · оценка`}
                    headerStyle={{ background: group.color }}
                    counterText={`${done} / ${group.books.length} прочитано`}
                    collapsed={collapsed}
                    onToggle={() => toggleLevel(key)}
                  >
                    {group.books.map((sb) => (
                      <SyllabusItem
                        key={sb.id}
                        book={sb}
                        progress={lessonProgress[sb.id]}
                        isLoading={openingLesson === sb.id}
                        onOpen={() => void openSharedLesson(sb, filteredKlexikon)}
                      />
                    ))}
                  </LevelSection>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── My lessons (AI-generated, private) ──────────────────────────────── */}
      {activeTab === "lessons" && (
        <>
          {!user ? (
            <div className="seed-card">
              <Wand2 size={42} style={{ color: "var(--accent)" }} />
              <h3>Войдите, чтобы генерировать уроки</h3>
              <p>Уроки сохраняются в вашем аккаунте и видны только вам.</p>
            </div>
          ) : (
            <>
              <div className="lesson-form">
                <label className="lesson-field">
                  <span>Тема</span>
                  <div className="lesson-input-row">
                    <input
                      type="text"
                      placeholder="Например: Wohnungssuche in Berlin"
                      value={lessonTopic}
                      onChange={(e) => setLessonTopic(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void generateLesson(); }}
                      maxLength={200}
                    />
                    <DictateButton
                      lang={profile.nativeLanguage}
                      title="Наговорить тему"
                      onText={(t) => setLessonTopic((prev) => appendSpoken(prev, t))}
                    />
                  </div>
                </label>

                <label className="lesson-field">
                  <span>Детали <em>необязательно</em></span>
                  <div className="lesson-input-row">
                    <textarea
                      rows={3}
                      placeholder="Например: друг держит цветочный магазин, живём вместе"
                      value={lessonContext}
                      onChange={(e) => setLessonContext(e.target.value)}
                      maxLength={1000}
                    />
                    <DictateButton
                      lang={profile.nativeLanguage}
                      title="Наговорить детали"
                      onText={(t) => setLessonContext((prev) => appendSpoken(prev, t))}
                    />
                  </div>
                  <small>Факты отсюда важнее слов на повторении: слово, которое им противоречит, будет пропущено.</small>
                </label>

                <div className="lesson-row">
                  <label className="lesson-field">
                    <span>Уровень</span>
                    <select value={lessonLevel} onChange={(e) => setLessonLevel(e.target.value as CefrLevel)}>
                      {(["A1","A2","B1","B2","C1","C2"] as CefrLevel[]).map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                  <label className="lesson-field">
                    <span>Объём</span>
                    <select value={lessonLength} onChange={(e) => setLessonLength(e.target.value as "short" | "medium" | "long")}>
                      <option value="short">Короткий</option>
                      <option value="medium">Средний</option>
                      <option value="long">Длинный</option>
                    </select>
                  </label>
                </div>

                <label className="lesson-check">
                  <input
                    type="checkbox"
                    // With nothing due, a checked-but-disabled box would read as
                    // "words will be used" when none can be.
                    checked={useReviewWords && dueReviewWords.length > 0}
                    onChange={(e) => setUseReviewWords(e.target.checked)}
                    disabled={dueReviewWords.length === 0}
                  />
                  <span>
                    {dueReviewWords.length > 0
                      ? `Использовать ${dueReviewWords.length} слов(а) из карточек, готовых к повторению`
                      : "Нет карточек, готовых к повторению"}
                  </span>
                </label>

                {useReviewWords && dueReviewWords.length > 0 && (
                  <div className="lesson-words">
                    {dueReviewWords.map((w) => <span key={w}>{w}</span>)}
                  </div>
                )}

                <button
                  type="button"
                  className="seed-btn"
                  onClick={() => void generateLesson()}
                  disabled={isGenerating || !lessonTopic.trim()}
                >
                  {isGenerating ? <><Loader2 className="spin" size={15} />Генерирую урок...</> : <><Wand2 size={15} />Сгенерировать урок</>}
                </button>

                {generateError && <div className="inline-error">{generateError}</div>}
              </div>

              {myLessons.length === 0 ? (
                <div className="empty-state">
                  <Wand2 size={40} /><strong>Уроков пока нет</strong>
                  <p>Задайте тему выше — текст будет написан под ваш уровень</p>
                </div>
              ) : (
                <div className="syllabus-timeline" style={{ borderLeftColor: "rgba(240,230,211,0.15)" }}>
                  {myLessons.map((lesson) => (
                    <div key={lesson.id}>
                      <SyllabusItem
                        book={lesson}
                        progress={lessonProgress[lesson.id]}
                        isLoading={openingLesson === lesson.id}
                        onOpen={() => void openSharedLesson(lesson, myLessons)}
                        onDelete={() => void deleteLesson(lesson.id)}
                        onRefine={() => openRefine(lesson.id)}
                        isRefineOpen={refiningId === lesson.id}
                      />

                      {refiningId === lesson.id && (
                        <div className="refine-panel">
                          <span className="refine-label">Что изменить в тексте</span>
                          <div className="lesson-input-row">
                            <textarea
                              rows={3}
                              autoFocus
                              placeholder="Например: друг работает не в магазине, а в цветочной лавке; мы живём вместе, а не по отдельности"
                              value={refineText}
                              onChange={(e) => setRefineText(e.target.value)}
                              maxLength={2000}
                            />
                            <DictateButton
                              lang={profile.nativeLanguage}
                              title="Наговорить правки"
                              onText={(t) => setRefineText((prev) => appendSpoken(prev, t))}
                            />
                          </div>
                          <small>Остальной текст останется как есть — меняется только то, о чём вы просите, и то, что из этого следует.</small>
                          <div className="refine-actions">
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => { setRefiningId(null); setRefineText(""); setRefineError(null); }}
                              disabled={isRefining}
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              className="mini-btn refine-apply"
                              onClick={() => void refineLesson(lesson.id)}
                              disabled={isRefining || !refineText.trim()}
                            >
                              {isRefining ? <><Loader2 className="spin" size={13} />Переписываю...</> : <><Pencil size={13} />Применить</>}
                            </button>
                          </div>
                          {refineError && <div className="inline-error">{refineError}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
            <h3>Импорт материалов</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 16px" }}>
              Загружаем тексты из открытых источников. Контент сохраняется для всех пользователей...
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
  /** Only generated lessons can be removed or revised — public content is shared. */
  onDelete?: () => void;
  onRefine?: () => void;
  isRefineOpen?: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  klexikon: "Klexikon",
  universal_cefr: "UniversalCEFR",
  generated: "ИИ",
  oersi: "OERSI",
};

function SyllabusItem({ book, progress, isLoading, showLang, onOpen, onDelete, onRefine, isRefineOpen }: SyllabusItemProps) {
  const status = progress?.status ?? "not_started";
  const sourceUrl = book.metadata?.source_url;
  const license = book.metadata?.license;
  const isGenerated = book.source_type === "generated";
  return (
    <div className={`syllabus-item ${status === "completed" ? "completed" : status === "in_progress" ? "active" : ""}`}>
      <span className="syllabus-node" style={{
        background: status === "completed" ? "#7aab6a" : status === "in_progress" ? "var(--accent)" : undefined,
        boxShadow: status !== "not_started" ? "0 0 8px currentColor" : undefined,
      }} />
      <div className="syllabus-meta">
        {showLang && <span>{book.language.toUpperCase()}</span>}
        {book.cefr_level && (
          <span title={book.metadata?.level_estimated ? "Уровень оценён автоматически по читаемости текста" : undefined}>
            {book.cefr_level}{book.metadata?.level_estimated ? "≈" : ""}
          </span>
        )}
        {showLang && <span>•</span>}
        <span>{SOURCE_LABELS[book.source_type] ?? book.source_type}</span>
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
      {sourceUrl && (
        <a className="syllabus-source" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={11} />Оригинал{license ? ` · ${license}` : ""}
        </a>
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
            <><CheckCircle2 size={13} />Читать заново</>
          ) : status === "in_progress" ? (
            <><Clock size={13} />Продолжить</>
          ) : (
            <><PlayCircle size={13} />{isGenerated ? "Начать урок" : "Читать"}</>
          )}
        </button>
        {onRefine && (
          <button
            type="button"
            className={`mini-btn syllabus-refine ${isRefineOpen ? "open" : ""}`}
            onClick={onRefine}
            title="Изменить текст урока"
          >
            <Pencil size={13} />Изменить
          </button>
        )}
        {onDelete && (
          <button type="button" className="mini-btn syllabus-delete" onClick={onDelete} title="Удалить урок">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: dictation button ──────────────────────────────────────────

/** Appends dictated text rather than replacing, so speaking twice adds to what is there. */
function appendSpoken(previous: string, spoken: string): string {
  const base = previous.trim();
  return base ? `${base} ${spoken}` : spoken;
}

type DictateButtonProps = {
  /** BCP-47-ish language code; the topic and notes are written in the native language. */
  lang: string;
  title: string;
  onText: (text: string) => void;
};

/** Renders nothing where the Web Speech API is missing (Firefox, older Safari). */
function DictateButton({ lang, title, onText }: DictateButtonProps) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }
    const rec = startRecognition(lang, {
      onResult: onText,
      onEnd: () => { recognizerRef.current = null; setListening(false); },
      onError: () => { recognizerRef.current = null; setListening(false); },
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
  };

  return (
    <button
      type="button"
      className={`dictate-btn ${listening ? "live" : ""}`}
      onClick={toggle}
      aria-label={title}
      title={title}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
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
  .source-note {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 9px 11px;
    margin: 0 0 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(240,230,211,0.04);
    color: var(--text-muted);
  }
  .source-note > svg { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
  .source-note strong { display: block; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-primary); }
  .source-note p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; }

  .lesson-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    margin-bottom: 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(240,230,211,0.03);
  }
  .lesson-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .lesson-field { display: flex; flex-direction: column; gap: 5px; }
  .lesson-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .lesson-field > span em { font-style: normal; opacity: 0.6; text-transform: none; letter-spacing: 0; }
  .lesson-field > small { font-size: 11.5px; line-height: 1.4; color: var(--text-muted); opacity: 0.8; }
  .lesson-field input, .lesson-field select, .lesson-field textarea {
    width: 100%;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-elevated, rgba(0,0,0,0.2));
    color: var(--text-primary);
    font-size: 14px;
  }
  .lesson-field input, .lesson-field select { height: 38px; }
  .lesson-field textarea, .refine-panel textarea {
    padding: 9px 10px;
    font-family: inherit;
    line-height: 1.45;
    resize: vertical;
  }

  /* Text field paired with its dictation button. */
  .lesson-input-row { display: flex; align-items: flex-start; gap: 8px; }
  .lesson-input-row > input, .lesson-input-row > textarea { flex: 1; min-width: 0; }
  .dictate-btn {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--bg-card);
    color: var(--text-muted);
    transition: all var(--transition-fast);
  }
  .dictate-btn:hover { color: var(--accent); border-color: var(--accent); }
  .dictate-btn.live {
    color: #e08888;
    border-color: #e08888;
    background: rgba(224,136,136,0.12);
    animation: dictate-pulse 1.2s ease-in-out infinite;
  }
  @keyframes dictate-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .refine-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: -4px 0 14px 14px;
    padding: 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: rgba(212,168,71,0.05);
  }
  .refine-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); }
  .refine-panel textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-elevated, rgba(0,0,0,0.2));
    color: var(--text-primary);
    font-size: 14px;
  }
  .refine-panel > small { font-size: 11.5px; line-height: 1.4; color: var(--text-muted); opacity: 0.8; }
  .refine-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .refine-apply { gap: 4px; background: rgba(212,168,71,0.14); color: var(--accent); border: 1px solid rgba(212,168,71,0.3); }
  .refine-apply:disabled { opacity: 0.5; }
  .syllabus-refine { gap: 4px; color: var(--text-muted); background: rgba(240,230,211,0.05); }
  .syllabus-refine:hover, .syllabus-refine.open { color: var(--accent); }
  .lesson-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); }
  .lesson-check input { width: 16px; height: 16px; accent-color: var(--accent); }
  .lesson-words { display: flex; flex-wrap: wrap; gap: 5px; }
  .lesson-words span {
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(212,168,71,0.12);
    color: var(--accent);
    font-size: 11.5px;
  }

  .syllabus-source {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
  }
  .syllabus-source:hover { color: var(--accent); }
  .syllabus-delete {
    padding: 0 8px;
    color: var(--text-muted);
    background: rgba(240,230,211,0.05);
  }
  .syllabus-delete:hover { color: #d98080; }

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
    /* Four tabs do not fit a phone width, so the row scrolls sideways. The
       scrollbar itself is hidden globally (see styles/globals.css); repeated
       here so the rule survives if that global ever changes. */
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    /* Keeps a sideways swipe on the tabs from triggering the browser's
       back-navigation gesture. */
    overscroll-behavior-x: contain;
  }
  .discover-tabs::-webkit-scrollbar { display: none; }
  .discover-tab-btn {
    /* Grow to share the row when it fits, never shrink below the label — that
       is what makes the row overflow into a scroll instead of clipping text. */
    flex: 1 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
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
  /* Three buttons do not fit a phone width; wrap the row rather than let the
     labels break across lines inside a button. */
  .syllabus-action-row { width: 100%; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .syllabus-action-row .mini-btn { white-space: nowrap; }
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X, BookOpen, GraduationCap, Server, Loader2, BookMarked, Sparkles, Clock, Headphones, Wand2, Plus, Target, ListRestart, Camera, ClipboardList, Tv, ClipboardCheck } from "lucide-react";
import { TestsTab } from "@/components/assessment/TestsList";
import { VideosView } from "@/components/videos/VideosView";
import type { Book, LessonContext, CefrLevel, Flashcard, UserProfile, Audiobook } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";
import { AudiobookDetailModal } from "./AudiobookDetailModal";
import { fetchAudiobooks, AUDIOBOOK_LANGUAGES, type AudiobookLanguageKey } from "@/lib/audio/audiobooks";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders, sbInsertFlashcard } from "@/lib/db/supabase";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { freshFetch } from "@/lib/net/freshFetch";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import { buildKnownWordSet, computeCoverage, COMFORT_MIN, COMFORT_MAX, type Coverage } from "@/lib/text/vocab";
import { LessonComposerModal, type ComposerState, type LessonKind, type LessonLength } from "./LessonComposerModal";
import { LessonRefineModal } from "./LessonRefineModal";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { EditMetadataModal } from "@/components/ui/EditMetadataModal";
import { STYLES } from "./discoverStyles";
import { LevelSection, SyllabusItem, CatalogSkeleton } from "./discoverParts";

type Props = {
  books: Book[];
  cards: Flashcard[];
  profile: UserProfile;
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  /** A saved homework set (metadata.lesson_kind === "homework") opens into its own interactive view, not the reader. */
  onOpenHomework: (sharedBook: { id: string; title: string; language: string; metadata: Record<string, unknown> }) => void;
  /** Book whose text is being fetched right now, so its tile can show a spinner. */
  openingBookId?: string | null;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
  /** Turning a dictionary entry into a flashcard goes through the app's single card path. */
  onAddCard?: (card: Flashcard) => void;
  /** Reload user flashcards from server when a photographed page adds some. */
  onReloadCards?: () => void;
  onFindVideos?: (word: string, lang?: string) => void;
  initialTab?: TabKey;
  /**
   * A pack sent over from Словарь to be written up as a text or a lesson.
   *
   * The composer lives here, the packs live there; rather than duplicating the
   * composer, the dictionary navigates here and hands the pack over. Consumed
   * once — `onPackConsumed` clears it so returning to Каталог later does not
   * pop the composer open again.
   */
  initialPack?: { title: string; brief: string; words: string[] } | null;
  onPackConsumed?: () => void;
  initialVideoQuery?: string | null;
  initialVideoLang?: string | null;
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

export type SharedBook = {
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
    /** Word frequency of the text, written at import; drives coverage. */
    word_counts?: Record<string, number>;
    token_total?: number;
    /** "text" = prose to read, "lesson" = a lesson to work through. */
    lesson_kind?: string;
    [key: string]: unknown;
  };
  created_at: string;
};

type TabKey = "classic" | "audio" | "klexikon" | "cefr" | "videos" | "lessons" | "tests";

// The order the owner asked for: own material first, then tests, then the
// shelves used most, then the rest.
const TAB_ORDER: TabKey[] = ["lessons", "tests", "cefr", "videos", "audio", "classic", "klexikon"];

// Each tab is one source. The name carries it; the source and its licence show
// up per item (the "Оригинал · CC BY-SA" link, the "≈" on estimated levels)
// rather than in a banner above the list.
const TAB_LABELS: Record<TabKey, string> = {
  classic: "Классика",
  audio: "Аудио",
  klexikon: "Клексикон",
  cefr: "CEFR тексты",
  videos: "Видео",
  lessons: "Мои уроки",
  tests: "Тесты",
};

type LessonProgressMap = Record<string, {
  status: "not_started" | "in_progress" | "completed";
  percentage: number;
  paragraph_index: number;
}>;

const PAGE_SIZE = 18;
// The shared shelves are browsed by level rather than searched one title at a
// time, so they get a longer page than the Gutenberg catalogue. Still bounded:
// every row carries its word-frequency map, and fetching the whole shelf is
// what made the tab slow in the first place.
const SHELF_PAGE_SIZE = 36;

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
  onlyComfortable?: boolean;
  cefrStatusFilter?: string;
  collapsedLevels?: string[];
  lessonLevel?: CefrLevel;
  lessonLength?: "short" | "medium" | "long";
  audioLang?: string;
  audioCefr?: string;
};

function readPrefs(): DiscoverPrefs {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as DiscoverPrefs;
    // Stored preferences outlive the code that wrote them: a returning user can
    // carry a tab name that no longer exists (e.g. the retired "wikibooks").
    // Dropping it here keeps every TAB_LABELS lookup total.
    if (parsed.activeTab && !(parsed.activeTab in TAB_LABELS)) {
      delete parsed.activeTab;
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * The AI's full analysis, corrected by the coursebook's own facts. The model
 * brings richer translations, an explanation and five examples; the entry
 * brings the article, plural and level as the course printed them — and the
 * page's own example goes first.
 */
export function DiscoverView({
  books,
  cards,
  profile,
  onBooksChange,
  onOpenBook,
  onOpenHomework,
  downloadTasks,
  onDownloadBook,
  onAddCard,
  onReloadCards,
  onFindVideos,
  initialTab,
  initialPack,
  onPackConsumed,
  initialVideoQuery,
  initialVideoLang,
}: Props) {
  const { user } = useAuth();
  const [prefs] = useState<DiscoverPrefs>(readPrefs);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (initialTab) return initialTab;
    return prefs.activeTab ?? "classic";
  });

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

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

  // Audiobooks States
  const [audioLang, setAudioLang] = useState<AudiobookLanguageKey | string>(prefs.audioLang ?? "de");
  const [audioCefr, setAudioCefr] = useState<CefrLevel | "all">((prefs.audioCefr as CefrLevel | "all") ?? "all");
  const [audioQuery, setAudioQuery] = useState("");
  const [audioSubmittedQuery, setAudioSubmittedQuery] = useState("");
  const [audioPage, setAudioPage] = useState(1);
  const [audioTotal, setAudioTotal] = useState(0);
  const [audioTotalPages, setAudioTotalPages] = useState(1);
  // Set only under a level filter: how many of this page's results actually
  // classify at that level, once the honest-label filter has run — audioTotal
  // still describes the underlying keyword search and would overclaim if
  // shown as "N books at this level" (see fetchAudiobooks).
  const [audioMatchedOnPage, setAudioMatchedOnPage] = useState<number | null>(null);
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [selectedAudiobook, setSelectedAudiobook] = useState<Audiobook | null>(null);
  const audioCacheRef = useRef<Map<string, { audiobooks: Audiobook[]; total: number; totalPages: number; matchedOnPage?: number }>>(new Map());

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
  // The typed query, settled: it is a server filter now, so it is debounced
  // rather than sent on every keystroke.
  const [klexSearch, setKlexSearch] = useState("");
  // Applies to whichever catalogue tab is open: keep only texts sitting in the
  // learner's productive band.
  const [onlyComfortable, setOnlyComfortable] = useState(prefs.onlyComfortable ?? false);
  // Where the next Klexikon import batch should resume from (reported by the
  // seed route, persisted so it survives a reload).
  const [klexikonOffset, setKlexikonOffset] = useState(prefs.klexikonOffset ?? 0);

  // "Мои уроки": both forms live in bottom sheets, so the tab itself stays a
  // plain list. `composerOpen` / `refiningId` are what is on screen.
  const [composerOpen, setComposerOpen] = useState(false);
  // Which of the two documents is being made is asked first, on its own step:
  // a text and a lesson are different things, not one thing with a switch.
  const [composerStep, setComposerStep] = useState<"kind" | "form">("kind");
  const [composer, setComposer] = useState<ComposerState>({
    kind: "text",
    topic: "",
    context: "",
    level: prefs.lessonLevel ?? "A2",
    length: prefs.lessonLength ?? "medium",
    useReviewWords: true,
  });
  const patchComposer = useCallback(
    (patch: Partial<ComposerState>) => setComposer((prev) => ({ ...prev, ...patch })),
    []
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  // "lesson" photographs a text to read; "dictionary" photographs words to learn.
  const [photoMode, setPhotoMode] = useState<"lesson" | "dictionary" | "homework">("lesson");
  const [editingLesson, setEditingLesson] = useState<SharedBook | null>(null);

  // The shared shelves are paged; only the visible page is fetched.
  const [klexPage, setKlexPage] = useState(1);
  const [cefrPage, setCefrPage] = useState(1);
  const [klexTotal, setKlexTotal] = useState(0);
  const [cefrTotal, setCefrTotal] = useState(0);

  // Surfaces a degraded result from the photo flow: the lesson was saved, but
  // not in the form it was meant to take.
  const [toast, setToast] = useState<string | null>(null);
  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  // Revising an existing lesson: which one is open, and the notes for it.
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");
  const [refineLength, setRefineLength] = useState<LessonLength | null>(null);
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
      // One page each, not the whole shelf: these rows carry a word-frequency
      // map apiece, and fetching all of them to show eighteen tiles was the
      // slowest thing in the app.
      //
      // Because only one page is here, the shelf's own filters — language,
      // level, title — have to be applied by the server. Narrowing eighteen
      // rows on the client emptied the shelf: asking for English left whatever
      // handful of English texts happened to land on the current page, and the
      // other hundreds were never fetched to be filtered.
      const klexParams = new URLSearchParams({
        source_type: "klexikon",
        limit: String(SHELF_PAGE_SIZE),
        offset: String((klexPage - 1) * SHELF_PAGE_SIZE),
      });
      if (klexLevelFilter) klexParams.set("cefr_level", klexLevelFilter);
      if (klexSearch) klexParams.set("q", klexSearch);

      const cefrParams = new URLSearchParams({
        source_type: "universal_cefr",
        limit: String(SHELF_PAGE_SIZE),
        offset: String((cefrPage - 1) * SHELF_PAGE_SIZE),
        order_by: "level",
      });
      if (cefrLangFilter) cefrParams.set("language", cefrLangFilter);
      if (cefrLevelFilter) cefrParams.set("cefr_level", cefrLevelFilter);

      const [klexRes, cefrRes] = await Promise.all([
        freshFetch(`/api/shared-books?${klexParams}`),
        freshFetch(`/api/shared-books?${cefrParams}`),
      ]);
      if (klexRes.ok) {
        const data = await klexRes.json() as { books: SharedBook[]; total?: number };
        setKlexikonBooks(data.books ?? []);
        setKlexTotal(data.total ?? 0);
      }
      if (cefrRes.ok) {
        const data = await cefrRes.json() as { books: SharedBook[]; total?: number };
        setCefrBooks(data.books ?? []);
        setCefrTotal(data.total ?? 0);
      }
    } catch (err) {
      console.error("loadSharedBooks:", err);
    } finally {
      setIsSharedLoading(false);
    }
  }, [klexPage, cefrPage, klexLevelFilter, klexSearch, cefrLangFilter, cefrLevelFilter]);

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
  }, [user, klexPage, cefrPage]);

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


  // Which words are already flashcards, so the entry says so instead of
  // silently making a duplicate.
  const cardFronts = useMemo(
    () => new Set(cards.map((c) => c.front.trim().toLowerCase())),
    [cards],
  );


  // A word or example tapped inside the audiobook's "Обсудить с AI" chat —
  // same save path as the dictionary above, just sourced from the book title
  // rather than a batch name.
  function addAudiobookWordCard(front: string, back: string, type: "word" | "phrase") {
    if (!onAddCard || !front.trim() || !back.trim()) return;
    if (cardFronts.has(front.trim().toLowerCase())) {
      showToast("Такая карточка уже есть");
      return;
    }
    const source = selectedAudiobook ? `Аудиокнига «${selectedAudiobook.title}»` : "Аудиокниги";
    const srs = createDefaultSrsFields(null, source);
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source,
      addedAt: new Date().toISOString(),
      ...srs,
      front,
      back,
    };
    onAddCard(card);
    showToast("✓ Карточка добавлена");
    if (user) {
      void sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: card.front,
        back: card.back,
        source_book_title: source,
        selection_type: type,
        repetitions: srs.repetitions,
        lapses: srs.lapses,
        easiness_factor: srs.easeFactor,
        interval_days: srs.intervalDays,
        next_review_at: srs.dueAt,
        last_reviewed_at: srs.lastReviewedAt,
        source_book_id: null,
        status: srs.status,
      });
    }
  }


  // The Klexikon title search is a server filter; settle the typing first.
  useEffect(() => {
    const timeout = window.setTimeout(() => setKlexSearch(klexQuery.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [klexQuery]);

  // A narrower filter means a shorter shelf, so page 7 of the old one is
  // usually past the end of the new one — start over at the first page.
  useEffect(() => { setKlexPage(1); }, [klexLevelFilter, klexSearch]);
  useEffect(() => { setCefrPage(1); }, [cefrLangFilter, cefrLevelFilter]);

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
      if (!cancelled && estimate) patchComposer({ level: estimate.level });
    });
    return () => { cancelled = true; };
  }, [prefs.lessonLevel, profile.targetLanguage, patchComposer]);

  // Persist tab + filters + collapsed sections
  useEffect(() => {
    const data: DiscoverPrefs = {
      activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter,
      klexLevelFilter, klexStatusFilter, collapsedLevels: Array.from(collapsedLevels),
      lessonLevel: composer.level, lessonLength: composer.length, klexikonOffset,
      onlyComfortable, audioLang, audioCefr,
    };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter, klexLevelFilter, klexStatusFilter, collapsedLevels, composer.level, composer.length, klexikonOffset, onlyComfortable, audioLang, audioCefr]);

  // ── Audiobooks auto-search ───────────────────────────────────────────────────
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = audioQuery.trim();
      if (nextQuery !== audioSubmittedQuery) {
        setAudioSubmittedQuery(nextQuery);
        setAudioPage(1);
      }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [audioQuery, audioSubmittedQuery]);

  useEffect(() => {
    if (activeTab !== "audio") return;
    const controller = new AbortController();
    const cacheKey = `${audioLang}:${audioCefr}:${audioSubmittedQuery}:${audioPage}`;

    const cached = audioCacheRef.current.get(cacheKey);
    if (cached) {
      setAudiobooks(cached.audiobooks);
      setAudioTotal(cached.total);
      setAudioTotalPages(cached.totalPages);
      setAudioMatchedOnPage(cached.matchedOnPage ?? null);
      setIsAudioLoading(false);
      return;
    }

    setIsAudioLoading(true);
    setAudioError(null);

    fetchAudiobooks({
      language: audioLang,
      cefrLevel: audioCefr,
      search: audioSubmittedQuery,
      page: audioPage,
      pageSize: PAGE_SIZE,
      signal: controller.signal,
    })
      .then((res) => {
        setAudiobooks(res.audiobooks);
        setAudioTotal(res.total);
        setAudioTotalPages(res.totalPages);
        setAudioMatchedOnPage(res.matchedOnPage ?? null);
        audioCacheRef.current.set(cacheKey, {
          audiobooks: res.audiobooks,
          total: res.total,
          totalPages: res.totalPages,
          matchedOnPage: res.matchedOnPage,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setAudioError("Не удалось загрузить каталог аудиокниг. Проверьте соединение.");
      })
      .finally(() => {
        setIsAudioLoading(false);
      });

    return () => controller.abort();
  }, [activeTab, audioLang, audioCefr, audioSubmittedQuery, audioPage]);

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
    // A homework set is filled in, not read — it opens into its own
    // interactive view, which does its own fetch of the exercises.
    if (sharedBook.metadata?.lesson_kind === "homework") {
      onOpenHomework(sharedBook);
      return;
    }
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
  }, [lessonProgress, onOpenBook, onOpenHomework]);

  function submitSearch() { setSubmittedQuery(query.trim()); setPage(1); }
  function clearSearch() { setQuery(""); setSubmittedQuery(""); setPage(1); }

  // ── Long-running catalogue jobs (server-sent progress) ──────────────────────
  const runSseJob = async (url: string, initialMessage: string) => {
    setIsSeeding(true);
    setSeedProgress(5);
    setSeedMessage(initialMessage);
    setSeedError(null);
    try {
      const res = await fetch(url, { headers: await sbAuthHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `Ошибка (${res.status})`);
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

  // Klexikon is imported in batches; `offset` resumes where the previous run
  // stopped, so repeated presses walk through the wiki instead of redoing it.
  const startImport = (type: "klexikon" | "cefr", offset = 0) =>
    runSseJob(`/api/books/seed?type=${type}&offset=${offset}`, "Инициализация импорта...");

  // One-off for texts imported before coverage existed.
  const startVocabReindex = () =>
    runSseJob("/api/books/reindex-vocab", "Считаю словарь текстов...");

  // ── Generate a lesson ────────────────────────────────────────────────────────
  // Words the SRS says are due now — feeding them to the generator is the whole
  // point of this tab: the text is built around what needs revising today.
  // ── Vocabulary coverage ──────────────────────────────────────────────────────
  // Everything the learner has ever saved counts as known, not just what is due:
  // the question here is "can I read this", not "do I need to revise this".
  const knownWords = useMemo(
    () => buildKnownWordSet(cards.map((c) => c.front)),
    [cards]
  );

  const coverageOf = useCallback(
    (book: SharedBook): Coverage | null =>
      computeCoverage(
        { wordCounts: book.metadata?.word_counts, tokenTotal: book.metadata?.token_total },
        knownWords
      ),
    [knownWords]
  );

  // Texts imported before coverage existed carry no frequency data. Surfacing
  // the backfill button only while some are missing keeps it out of the way
  // once the catalogue is indexed.
  const needsVocabIndex = useMemo(
    () => [...klexikonBooks, ...cefrBooks].some((b) => !b.metadata?.token_total),
    [klexikonBooks, cefrBooks]
  );

  const dueReviewWords = useMemo(() => {
    const now = Date.now();
    return cards
      .filter((c) => c.type === "word" && new Date(c.dueAt).getTime() <= now)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 12)
      .map((c) => c.front);
  }, [cards]);

  const generateLesson = async () => {
    const topic = composer.topic.trim();
    if (!topic || isGenerating) return;

    setIsGenerating(true);
    setGenerateError(null);
    try {
      // A pack brings its own words and its own brief; without one the text is
      // written around whatever the deck says is due.
      const packWords = composer.packWords ?? [];
      const res = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          kind: composer.kind,
          topic,
          context: composer.context.trim(),
          level: composer.level,
          length: composer.length,
          targetLanguage: profile.targetLanguage,
          nativeLanguage: profile.nativeLanguage,
          reviewWords: packWords.length > 0
            ? packWords
            : composer.useReviewWords ? dueReviewWords : [],
          packTitle: composer.packTitle ?? "",
          packBrief: composer.packBrief ?? "",
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Ошибка генерации (${res.status})`);
      // Level and length are deliberately kept for the next one; the pack is
      // not — it belonged to this request.
      patchComposer({ topic: "", context: "", packTitle: undefined, packBrief: undefined, packWords: undefined });
      setComposerOpen(false);
      setActiveTab("lessons");
      await loadMyLessons();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsGenerating(false);
    }
  };

  const openComposer = () => {
    setGenerateError(null);
    setComposerStep("kind");
    patchComposer({ packTitle: undefined, packBrief: undefined, packWords: undefined });
    setComposerOpen(true);
  };

  /**
   * «Сделать текст или урок» from a pack.
   *
   * The pack is the material and the brief at once: its words go in, and the
   * description it was collected under tells the model what kind of language
   * the learner is actually working on — which is the difference between a
   * story that happens to contain the words and one built out of the pattern
   * they were collected for.
   */
  const openComposerForPack = (pack: { title: string; brief: string; words: string[] }) => {
    setGenerateError(null);
    setComposerStep("kind");
    setComposer((prev) => ({
      ...prev,
      topic: pack.title,
      context: "",
      packTitle: pack.title,
      packBrief: pack.brief,
      packWords: pack.words,
    }));
    setComposerOpen(true);
  };

  // A pack handed over from Словарь: open the composer on it as soon as this
  // screen mounts with one, then let go of it.
  useEffect(() => {
    if (!initialPack) return;
    setActiveTab("lessons");
    openComposerForPack(initialPack);
    onPackConsumed?.();
    // openComposerForPack is re-created every render and is a pure setter
    // chain; keying on the pack itself is what actually decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPack]);

  const refineLesson = async (id: string) => {
    const instructions = refineText.trim();
    if ((!instructions && !refineLength) || isRefining) return;

    setIsRefining(true);
    setRefineError(null);
    try {
      const res = await fetch(`/api/lessons/${id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({ instructions, ...(refineLength ? { length: refineLength } : {}) }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Ошибка правки (${res.status})`);
      setRefineText("");
      setRefineLength(null);
      setRefiningId(null);
      setRefineError(null);
      await loadMyLessons();
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsRefining(false);
    }
  };

  const openRefine = (id: string) => {
    setRefiningId(id);
    setRefineText("");
    setRefineLength(null);
    setRefineError(null);
  };

  const closeRefine = () => {
    setRefiningId(null);
    setRefineText("");
    setRefineLength(null);
    setRefineError(null);
  };

  const refiningLesson = useMemo(
    () => myLessons.find((l) => l.id === refiningId) ?? null,
    [myLessons, refiningId]
  );

  const deleteLesson = async (id: string) => {
    if (!confirm("Удалить этот урок?")) return;
    try {
      const res = await fetch(`/api/lessons?id=${id}`, { method: "DELETE", headers: await sbAuthHeaders() });
      if (res.ok) setMyLessons((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error("deleteLesson:", err);
    }
  };

  async function saveLessonMetadata(title: string, description: string) {
    if (!editingLesson) return;
    const res = await fetch("/api/lessons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
      body: JSON.stringify({ id: editingLesson.id, title, description }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить урок.");
    await loadMyLessons();
    showToast("Урок обновлён");
  }

  const matchStatus = useCallback((bookId: string, filter: string) => {
    if (!filter) return true;
    const status = lessonProgress[bookId]?.status ?? "not_started";
    return status === filter;
  }, [lessonProgress]);

  // ── Klexikon articles ────────────────────────────────────────────────────────
  // Level and title are filtered by the server (see loadSharedBooks); what is
  // left here is what the shelf cannot know — this reader's own progress and
  // vocabulary. Those still narrow a page rather than the whole shelf.
  const filteredKlexikon = useMemo(() => {
    return klexikonBooks.filter((b) => {
      if (!matchStatus(b.id, klexStatusFilter)) return false;
      if (onlyComfortable && !coverageOf(b)?.isComfortable) return false;
      return true;
    });
  }, [klexikonBooks, klexStatusFilter, matchStatus, onlyComfortable, coverageOf]);
  const klexikonGrouped = useMemo(() => groupByCefr(filteredKlexikon), [filteredKlexikon]);
  const klexFiltersActive = Boolean(klexLevelFilter || klexStatusFilter || klexSearch || onlyComfortable);

  // ── Filtered CEFR texts ──────────────────────────────────────────────────────
  const filteredCefrBooks = useMemo(() => {
    return cefrBooks.filter((b) => {
      if (!matchStatus(b.id, cefrStatusFilter)) return false;
      if (onlyComfortable && !coverageOf(b)?.isComfortable) return false;
      return true;
    });
  }, [cefrBooks, cefrStatusFilter, matchStatus, onlyComfortable, coverageOf]);
  const cefrGrouped = useMemo(() => groupByCefr(filteredCefrBooks), [filteredCefrBooks]);
  const cefrFiltersActive = Boolean(cefrLangFilter || cefrLevelFilter || cefrStatusFilter || onlyComfortable);

  const completedKlexikon = useMemo(() =>
    klexikonBooks.filter((b) => lessonProgress[b.id]?.status === "completed").length,
    [klexikonBooks, lessonProgress]
  );

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
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            ref={activeTab === tab ? activeTabRef : undefined}
            className={`discover-tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "classic" && <BookOpen size={15} />}
            {tab === "audio" && <Headphones size={15} />}
            {tab === "klexikon" && <GraduationCap size={15} />}
            {tab === "cefr" && <BookMarked size={15} />}
            {tab === "videos" && <Tv size={15} />}
            {tab === "lessons" && <Wand2 size={15} />}
            {tab === "tests" && <ClipboardCheck size={15} />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === "tests" && <TestsTab />}

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

      {/* ── Audiobooks (LibriVox / Internet Archive) ─────────────────────────── */}
      {activeTab === "audio" && (
        <>
          <div className="discover-search" style={{ marginBottom: 8 }}>
            <Search size={18} aria-hidden />
            <input
              type="text"
              placeholder="Поиск аудиокниги, автора..."
              value={audioQuery}
              onChange={(e) => setAudioQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setAudioSubmittedQuery(audioQuery.trim());
                  setAudioPage(1);
                }
                if (e.key === "Escape") {
                  setAudioQuery("");
                  setAudioSubmittedQuery("");
                  setAudioPage(1);
                }
              }}
            />
            {audioQuery && (
              <button
                type="button"
                className="discover-clear"
                onClick={() => {
                  setAudioQuery("");
                  setAudioSubmittedQuery("");
                  setAudioPage(1);
                }}
                aria-label="Очистить"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="audio-filters-row">
            <div className={`discover-language audio-lang-select${audioLang !== "all" ? " filter-active" : ""}`}>
              {audioLang !== "all" && <span className="filter-lamp" aria-hidden />}
              <select
                value={audioLang}
                onChange={(e) => {
                  setAudioLang(e.target.value);
                  setAudioPage(1);
                }}
                aria-label="Язык аудио"
              >
                {(Object.entries(AUDIOBOOK_LANGUAGES) as [AudiobookLanguageKey, typeof AUDIOBOOK_LANGUAGES[AudiobookLanguageKey]][]).map(
                  ([key, val]) => (
                    <option key={key} value={key}>
                      {val.flag} {val.label}
                    </option>
                  )
                )}
              </select>
              <ChevronDown size={15} aria-hidden />
            </div>

            {/* CEFR level filter — reuses the app's own filter-chip styling
                instead of raw, unstyled native buttons. */}
            <div className="filter-chips">
              {(["all", "A1", "A2", "B1", "B2", "C1", "C2"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className={`filter-chip ${audioCefr === lvl ? "active" : ""}`}
                  onClick={() => {
                    setAudioCefr(lvl);
                    setAudioPage(1);
                  }}
                >
                  {lvl === "all" ? "Все уровни" : lvl}
                </button>
              ))}
            </div>
          </div>

          {audioError && <div className="inline-error">{audioError}</div>}

          {isAudioLoading && (
            <div className="catalog-loading-inline">
              <span className="loading-dot" />
              <span>Загружаю каталог аудиокниг...</span>
            </div>
          )}

          <div className="discover-meta">
            <span>
              {isAudioLoading
                ? "Поиск..."
                : audioCefr !== "all"
                  // audioTotal counts the underlying keyword search, not
                  // confirmed matches — showing it here would repeat the
                  // exact "A1 label on a B1 book" bug this fix removes.
                  ? `${audioMatchedOnPage ?? audiobooks.length} уровня ${audioCefr} на этой странице`
                  : `${audioTotal || audiobooks.length} аудиокниг`}
            </span>
            <span>
              Страница {audioPage} из {audioTotalPages}
            </span>
          </div>

          {isAudioLoading && audiobooks.length === 0 ? (
            <CatalogSkeleton />
          ) : audiobooks.length === 0 ? (
            <div className="empty-state">
              <Headphones size={40} />
              <strong>Аудиокниги не найдены</strong>
              <p>
                {audioCefr !== "all"
                  ? `На этой странице нет аудиокниг, точно классифицированных как ${audioCefr}. Internet Archive почти не содержит подтверждённых материалов этого уровня — попробуйте следующую страницу, другой язык или соседний уровень.`
                  : "Попробуйте выбрать другой язык или уровень"}
              </p>
            </div>
          ) : (
            <>
              <div className={`discover-grid${isAudioLoading ? " is-refreshing" : ""}`}>
                {audiobooks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="catalog-book"
                    onClick={() => setSelectedAudiobook(b)}
                  >
                    <span
                      className="catalog-cover"
                      style={
                        b.coverUrl
                          ? { backgroundImage: `url(${b.coverUrl})` }
                          : { background: pickColor(b.title) }
                      }
                    >
                      <span
                        style={{
                          position: "absolute",
                          bottom: 4,
                          right: 4,
                          background: "rgba(0,0,0,0.75)",
                          borderRadius: "4px",
                          padding: "2px 4px",
                          display: "flex",
                          alignItems: "center",
                          gap: "2px",
                          color: "#fff",
                          fontSize: "10px",
                        }}
                      >
                        <Headphones size={11} />
                      </span>
                    </span>
                    <span className="catalog-book-body">
                      <strong>{b.title}</strong>
                      <span>{b.author}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                        {b.cefrLevel ? (
                          <span
                            className="cefr-badge"
                            title={b.cefrExplanation}
                            style={{
                              background: CEFR_COLORS[b.cefrLevel] || "#888",
                              color: "#fff",
                              padding: "1px 5px",
                              borderRadius: "3px",
                              fontSize: "10px",
                              fontWeight: "bold",
                              opacity: b.cefrConfidence === "approximate" ? 0.85 : 1,
                            }}
                          >
                            {b.cefrConfidence === "approximate" ? `≈ ${b.cefrLevel}` : b.cefrLevel}
                          </span>
                        ) : (
                          <span
                            className="cefr-badge"
                            title={b.cefrExplanation ?? "Уровень CEFR не подтверждён"}
                            style={{
                              background: "var(--bg-hover)",
                              color: "var(--text-muted)",
                              padding: "1px 5px",
                              borderRadius: "3px",
                              fontSize: "10px",
                              fontWeight: "bold",
                            }}
                          >
                            Оригинал
                          </span>
                        )}
                        {b.totalDurationFormatted && b.totalDurationFormatted !== "—" && (
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "2px" }}>
                            <Clock size={11} /> {b.totalDurationFormatted}
                          </span>
                        )}
                      </div>
                    </span>
                  </button>
                ))}
              </div>

              <div className="pager">
                <button
                  type="button"
                  className="mini-btn"
                  disabled={audioPage <= 1 || isAudioLoading}
                  onClick={() => setAudioPage((v) => Math.max(1, v - 1))}
                >
                  <ChevronLeft size={15} />
                  Назад
                </button>
                <span>
                  {audioPage} / {audioTotalPages}
                </span>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={audioPage >= audioTotalPages || isAudioLoading}
                  onClick={() => setAudioPage((v) => v + 1)}
                >
                  Вперёд
                  <ChevronRight size={15} />
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
              {klexTotal > 0
                ? `${filteredKlexikon.length} из ${klexTotal} • ${completedKlexikon} прочитано`
                : (klexFiltersActive ? "Ничего не найдено" : "Статьи не загружены")}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              {needsVocabIndex && (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => void startVocabReindex()}
                  style={{ gap: 4, height: 26, fontSize: 11 }}
                  title="Посчитать словарь для текстов, загруженных раньше"
                >
                  <ListRestart size={12} />Словарь
                </button>
              )}
              <button
                type="button"
                className="mini-btn"
                onClick={() => void startImport("klexikon", klexikonOffset)}
                style={{ gap: 4, height: 26, fontSize: 11 }}
              >
                {klexTotal > 0 ? "Загрузить ещё" : "Загрузить статьи"}
              </button>
            </span>
          </div>

          {(klexTotal > 0 || klexFiltersActive) && (
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
              <button
                type="button"
                className={`fits-toggle${onlyComfortable ? " on" : ""}`}
                onClick={() => setOnlyComfortable((v) => !v)}
                title={`Оставить тексты, где вы знаете ${Math.round(COMFORT_MIN * 100)}–${Math.round(COMFORT_MAX * 100)}% слов`}
              >
                <Target size={13} />Подходит вам
              </button>
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
          ) : klexikonBooks.length === 0 && !klexFiltersActive ? (
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
                        coverage={coverageOf(sb)}
                        onOpen={() => void openSharedLesson(sb, filteredKlexikon)}
                      />
                    ))}
                  </LevelSection>
                );
              })}
            </>
          )}

          {klexTotal > SHELF_PAGE_SIZE && (
            <div className="pager" style={{ marginTop: 16 }}>
              <button type="button" className="mini-btn" disabled={klexPage <= 1 || isSharedLoading} onClick={() => setKlexPage((v) => Math.max(1, v - 1))}>
                <ChevronLeft size={15} />Назад
              </button>
              <span>{klexPage} / {Math.max(1, Math.ceil(klexTotal / SHELF_PAGE_SIZE))}</span>
              <button type="button" className="mini-btn" disabled={klexPage >= Math.ceil(klexTotal / SHELF_PAGE_SIZE) || isSharedLoading} onClick={() => setKlexPage((v) => v + 1)}>
                Вперёд<ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Videos: Learning Hub ────────────────────────────────────────────── */}
      {activeTab === "videos" && (
        <VideosView
          cards={cards}
          profile={profile}
          userId={user?.id ?? null}
          initialQuery={initialVideoQuery}
          initialLanguage={initialVideoLang}
          onAddCard={onAddCard || (() => {})}
        />
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
              {myLessons.length > 0 && (
                <div className="discover-meta" style={{ marginBottom: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={14} style={{ color: "var(--accent)" }} />
                    {myLessons.length} текстов и уроков
                  </span>
                </div>
              )}

              {myLessons.length === 0 ? (
                <div className="empty-state">
                  <Wand2 size={40} /><strong>Здесь пока пусто</strong>
                  <p>Задайте тему — и получите текст для чтения или урок с упражнениями под ваш уровень</p>
                  <button type="button" className="seed-btn" onClick={openComposer} style={{ marginTop: 14 }}>
                    <Plus size={15} />Создать текст или урок
                  </button>
                </div>
              ) : (
                <div className="syllabus-timeline" style={{ borderLeftColor: "rgba(240,230,211,0.15)" }}>
                  {myLessons.map((lesson) => (
                    <SyllabusItem
                      key={lesson.id}
                      book={lesson}
                      progress={lessonProgress[lesson.id]}
                      isLoading={openingLesson === lesson.id}
                      coverage={coverageOf(lesson)}
                      onOpen={() => void openSharedLesson(lesson, myLessons)}
                      onDelete={() => void deleteLesson(lesson.id)}
                      onEdit={() => setEditingLesson(lesson)}
                      onRefine={lesson.metadata?.lesson_kind === "homework" ? undefined : () => openRefine(lesson.id)}
                    />
                  ))}
                </div>
              )}

              {/* All three within thumb reach: photograph a homework page, photograph a text, or write a topic */}
              <button
                type="button"
                className="add-lesson-fab tertiary"
                onClick={() => { setPhotoMode("homework"); setPhotoOpen(true); }}
                aria-label="Домашка из фотографии"
                title="Домашка из фотографии"
              >
                <ClipboardList size={20} />
              </button>
              <button
                type="button"
                className="add-lesson-fab secondary"
                onClick={() => { setPhotoMode("lesson"); setPhotoOpen(true); }}
                aria-label="Урок из фотографии"
                title="Урок из фотографии"
              >
                <Camera size={20} />
              </button>
              <button
                type="button"
                className="add-lesson-fab"
                onClick={openComposer}
                aria-label="Новый текст или урок"
                title="Новый текст или урок"
              >
                <Plus size={24} />
              </button>
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
            <button
              type="button"
              className={`fits-toggle${onlyComfortable ? " on" : ""}`}
              onClick={() => setOnlyComfortable((v) => !v)}
              title={`Оставить тексты, где вы знаете ${Math.round(COMFORT_MIN * 100)}–${Math.round(COMFORT_MAX * 100)}% слов`}
            >
              <Target size={13} />Подходит вам
            </button>
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
            <span>
              {cefrTotal > 0
                ? (cefrTotal > filteredCefrBooks.length
                    ? `${filteredCefrBooks.length} из ${cefrTotal} текстов`
                    : `${cefrTotal} текстов`)
                : (cefrFiltersActive ? "Ничего не найдено" : "Тексты не загружены")}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              {needsVocabIndex && (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => void startVocabReindex()}
                  style={{ gap: 4, height: 26, fontSize: 11 }}
                  title="Посчитать словарь для текстов, загруженных раньше"
                >
                  <ListRestart size={12} />Словарь
                </button>
              )}
              <button type="button" className="mini-btn" onClick={() => void startImport("cefr")} style={{ gap: 4, height: 26, fontSize: 11 }}>
                {cefrTotal > 0 ? "Обновить" : "Загрузить тексты"}
              </button>
            </span>
          </div>

          {isSharedLoading ? (
            <div className="catalog-loading-inline" style={{ justifyContent: "center", padding: "40px 0" }}>
              <Loader2 className="spin" size={24} /><span>Загрузка...</span>
            </div>
          ) : cefrBooks.length === 0 && !cefrFiltersActive ? (
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
                      coverage={coverageOf(sb)}
                      onOpen={() => void openSharedLesson(sb, filteredCefrBooks)}
                    />
                  ))}
                </LevelSection>
              );
            })
          )}

          {cefrTotal > SHELF_PAGE_SIZE && (
            <div className="pager" style={{ marginTop: 16 }}>
              <button type="button" className="mini-btn" disabled={cefrPage <= 1 || isSharedLoading} onClick={() => setCefrPage((v) => Math.max(1, v - 1))}>
                <ChevronLeft size={15} />Назад
              </button>
              <span>{cefrPage} / {Math.max(1, Math.ceil(cefrTotal / SHELF_PAGE_SIZE))}</span>
              <button type="button" className="mini-btn" disabled={cefrPage >= Math.ceil(cefrTotal / SHELF_PAGE_SIZE) || isSharedLoading} onClick={() => setCefrPage((v) => v + 1)}>
                Вперёд<ChevronRight size={15} />
              </button>
            </div>
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

      {/* A photograph becomes either a reading text or dictionary entries */}
      {photoOpen && (
        <PhotoLessonModal
          targetLanguage={profile.targetLanguage}
          nativeLanguage={profile.nativeLanguage}
          mode={photoMode}
          authHeaders={sbAuthHeaders}
          onClose={() => setPhotoOpen(false)}
          onCreated={(_id, warning) => {
            setPhotoOpen(false);
            void loadMyLessons();
            if (warning) showToast(warning);
          }}
          onWordsAdded={({ added, updated, warning }) => {
            setPhotoOpen(false);
            onReloadCards?.();
            showToast(
              warning
                ? warning
                : updated > 0
                  ? `Добавлено слов: ${added}, обновлено: ${updated}`
                  : `Добавлено слов: ${added}`,
            );
          }}
        />
      )}

      {/* New lesson */}
      {composerOpen && (
        <LessonComposerModal
          value={composer}
          onChange={patchComposer}
          step={composerStep}
          onPickKind={(kind: LessonKind) => { patchComposer({ kind }); setComposerStep("form"); }}
          dueReviewWords={dueReviewWords}
          nativeLanguage={profile.nativeLanguage}
          isGenerating={isGenerating}
          error={generateError}
          onSubmit={() => void generateLesson()}
          onClose={() => { if (!isGenerating) setComposerOpen(false); }}
        />
      )}

      {/* Revise an existing lesson */}
      {refiningLesson && (
        <LessonRefineModal
          lessonTitle={refiningLesson.title}
          kind={refiningLesson.metadata?.lesson_kind === "lesson" ? "lesson" : "text"}
          value={refineText}
          onChange={setRefineText}
          length={refineLength}
          onLengthChange={setRefineLength}
          nativeLanguage={profile.nativeLanguage}
          isRefining={isRefining}
          error={refineError}
          onSubmit={() => void refineLesson(refiningLesson.id)}
          onClose={() => { if (!isRefining) closeRefine(); }}
        />
      )}

      {editingLesson && (
        <EditMetadataModal
          kind="урока"
          title={editingLesson.title}
          description={String(editingLesson.metadata?.description ?? "")}
          onClose={() => setEditingLesson(null)}
          onSave={saveLessonMetadata}
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


      {/* Audiobook Details & Player Modal */}
      {selectedAudiobook && (
        <AudiobookDetailModal
          audiobook={selectedAudiobook}
          nativeLanguage={profile.nativeLanguage}
          onClose={() => setSelectedAudiobook(null)}
          onAddWordCard={addAudiobookWordCard}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X, BookOpen,
  GraduationCap, Server, Loader2, BookMarked,
  Sparkles, CheckCircle2, PlayCircle, Clock, Circle,
  Wand2, Trash2, ExternalLink, Pencil, Plus, Target, ListRestart, Camera, BookA,
} from "lucide-react";
import type { Book, LessonContext, CefrLevel, Flashcard, UserProfile } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";
import { useAuth } from "@/lib/auth/useAuth";
import { sbAuthHeaders, sbInsertFlashcard } from "@/lib/db/supabase";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { freshFetch } from "@/lib/net/freshFetch";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";
import { buildKnownWordSet, computeCoverage, COMFORT_MIN, COMFORT_MAX, type Coverage } from "@/lib/text/vocab";
import { LessonComposerModal, type ComposerState, type LessonKind, type LessonLength } from "./LessonComposerModal";
import { LessonRefineModal } from "./LessonRefineModal";
import { PhotoLessonModal } from "@/components/capture/PhotoLessonModal";
import { DictionaryPanel, entryToCardText, entryToAnalysis } from "@/components/dictionary/DictionaryPanel";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import type { TrainBatch } from "@/lib/cards";
import { WordModal } from "@/components/word-modal/WordModal";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis } from "@/lib/db/local";
import type { AiAnalysis } from "@/lib/types";

type Props = {
  books: Book[];
  cards: Flashcard[];
  profile: UserProfile;
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  /** Book whose text is being fetched right now, so its tile can show a spinner. */
  openingBookId?: string | null;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
  /** Turning a dictionary entry into a flashcard goes through the app's single card path. */
  onAddCard?: (card: Flashcard) => void;
  /** Open the flashcard module narrowed to one batch's cards. */
  /** «Тренировать эту пачку» — the pack carries its own training setup, if it has one. */
  onTrainWords?: (batch: TrainBatch) => void;
  /** Reload user flashcards from server when a batch is added/re-linked. */
  onReloadCards?: () => void;
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
    /** Word frequency of the text, written at import; drives coverage. */
    word_counts?: Record<string, number>;
    token_total?: number;
    /** "text" = prose to read, "lesson" = a lesson to work through. */
    lesson_kind?: string;
    [key: string]: unknown;
  };
  created_at: string;
};

type TabKey = "classic" | "klexikon" | "cefr" | "lessons" | "dictionary";

// Each tab is one source. The name carries it; the source and its licence show
// up per item (the "Оригинал · CC BY-SA" link, the "≈" on estimated levels)
// rather than in a banner above the list.
const TAB_LABELS: Record<TabKey, string> = {
  classic: "Классика",
  klexikon: "Клексикон",
  cefr: "CEFR тексты",
  lessons: "Мои уроки",
  dictionary: "Словарь",
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
function mergeEntryWithAnalysis(entry: DictionaryEntry, base: AiAnalysis, full: AiAnalysis): AiAnalysis {
  const aiWord = full.word!;
  const baseWord = base.word!;
  const examples = [
    ...(entry.example ? [{ text: entry.example, translation: entry.example_translation }] : []),
    ...(full.examples ?? []),
  ].filter((ex, i, list) => list.findIndex((o) => o.text.trim() === ex.text.trim()) === i);

  return {
    word: {
      ...aiWord,
      text: entry.headword,
      lemma: aiWord.lemma || entry.lemma,
      partOfSpeech: entry.part_of_speech || aiWord.partOfSpeech,
      posTag: baseWord.posTag !== "other" ? baseWord.posTag : aiWord.posTag,
      gender: entry.article || aiWord.gender,
      cefr: entry.cefr || aiWord.cefr,
      translation: aiWord.translation || entry.translation,
      explanation: [entry.note, aiWord.explanation].filter(Boolean).join("\n"),
      nounDetails: {
        article: entry.article || aiWord.nounDetails?.article,
        plural: entry.plural || aiWord.nounDetails?.plural,
      },
      verbDetails: aiWord.verbDetails ?? baseWord.verbDetails,
    },
    examples,
  };
}

export function DiscoverView({ books, cards, profile, onBooksChange, onOpenBook, downloadTasks, onDownloadBook, onAddCard, onTrainWords, onReloadCards }: Props) {
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
  const [photoMode, setPhotoMode] = useState<"lesson" | "dictionary">("lesson");

  // The shared shelves are paged; only the visible page is fetched.
  const [klexPage, setKlexPage] = useState(1);
  const [cefrPage, setCefrPage] = useState(1);
  const [klexTotal, setKlexTotal] = useState(0);
  const [cefrTotal, setCefrTotal] = useState(0);

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [dictBatches, setDictBatches] = useState<DictionaryBatch[]>([]);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);
  // The dictionary reuses the app-wide word modal rather than inventing its
  // own; the entry already holds everything the modal shows, so no AI call.
  const [dictWord, setDictWord] = useState<{ entry: DictionaryEntry; analysis: AiAnalysis; enriching: boolean } | null>(null);
  const [miniTextBusy, setMiniTextBusy] = useState(false);
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

  const loadDictionary = useCallback(async () => {
    if (!user) { setDictionary([]); return; }
    setDictLoading(true);
    setDictError(null);
    try {
      const res = await freshFetch(`/api/dictionary?language=${encodeURIComponent(profile.targetLanguage)}`, {
        headers: await sbAuthHeaders(),
      });
      const data = await res.json() as { entries?: DictionaryEntry[]; batches?: DictionaryBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить словарь.");
      setDictionary(data.entries ?? []);
      setDictBatches(data.batches ?? []);
    } catch (err) {
      setDictError(err instanceof Error ? err.message : "Не удалось загрузить словарь.");
    } finally {
      setDictLoading(false);
    }
  }, [user, profile.targetLanguage]);

  // Which words are already flashcards, so the entry says so instead of
  // silently making a duplicate.
  const cardFronts = useMemo(
    () => new Set(cards.map((c) => c.front.trim().toLowerCase())),
    [cards],
  );

  function addCardFromEntry(entry: DictionaryEntry) {
    if (!onAddCard) return;
    const { front, back } = entryToCardText(entry);
    if (cardFronts.has(front.trim().toLowerCase())) {
      showToast("Такая карточка уже есть");
      return;
    }
    const srs = createDefaultSrsFields(null, "Словарь");
    const card: Flashcard = {
      id: `card-${Date.now()}`,
      type: "word",
      source: "Словарь",
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
        source_book_title: "Словарь",
        selection_type: "word",
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

  async function deleteDictionaryEntry(id: string) {
    setDictionary((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/dictionary?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await sbAuthHeaders(),
      });
    } catch {
      void loadDictionary();
    }
  }

  async function deleteDictionaryBatch(batchId: string) {
    setDictionary((prev) => prev.filter((e) => e.batch_id !== batchId));
    setDictBatches((prev) => prev.filter((b) => b.id !== batchId));
    try {
      await fetch(`/api/dictionary?batchId=${encodeURIComponent(batchId)}`, {
        method: "DELETE",
        headers: await sbAuthHeaders(),
      });
    } catch {
      void loadDictionary();
    }
  }

  /**
   * Opening a dictionary word shows the same word modal as everywhere else,
   * instantly, from what the entry already knows — then quietly upgrades it
   * with the full AI analysis (five examples, explanation, verb details), so
   * the modal is identical to the one the reader's «Подробнее» opens. The
   * textbook's own facts win where they overlap: its article, plural and
   * level are the course's word, not the model's guess.
   */
  async function openDictWord(entry: DictionaryEntry) {
    const base = entryToAnalysis(entry);
    setDictWord({ entry, analysis: base, enriching: true });

    const lookup = entry.lemma || entry.headword;
    const cacheKey = makeAiCacheKey("word", lookup, profile.targetLanguage, profile.nativeLanguage);
    try {
      let full = getLocalAiAnalysis(cacheKey);
      if (!full?.word) {
        full = await analyzeSelection({
          mode: "word",
          word: lookup,
          text: lookup,
          sentence: entry.example || lookup,
          sentenceBefore: "",
          sentenceAfter: "",
          nativeLanguage: profile.nativeLanguage,
          targetLanguage: profile.targetLanguage,
        });
        if (full?.word) saveLocalAiAnalysis(cacheKey, full);
      }
      if (!full?.word) throw new Error("empty analysis");

      const merged = mergeEntryWithAnalysis(entry, base, full);
      setDictWord((cur) => (cur && cur.entry.id === entry.id ? { entry, analysis: merged, enriching: false } : cur));
    } catch {
      // The entry-only view is already complete enough to be useful.
      setDictWord((cur) => (cur && cur.entry.id === entry.id ? { ...cur, enriching: false } : cur));
    }
  }

  /**
   * A short reading text built around one word, saved as a lesson and opened
   * at once — the fastest way to see a dictionary word actually working.
   */
  async function createMiniTextForWord(entry: DictionaryEntry) {
    if (miniTextBusy) return;
    setMiniTextBusy(true);
    try {
      const level = ["A1", "A2", "B1", "B2", "C1", "C2"].includes(entry.cefr)
        ? entry.cefr
        : prefs.lessonLevel ?? "A2";
      const res = await freshFetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          level,
          topic: `Слово «${entry.headword}»`,
          targetLanguage: profile.targetLanguage,
          nativeLanguage: profile.nativeLanguage,
          reviewWords: [entry.headword],
          length: "short",
          context: `Короткий текст, построенный вокруг слова «${entry.headword}» (${entry.translation}): показать его в нескольких типичных ситуациях и формах, чтобы слово можно было рассмотреть со всех сторон.`,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Не удалось создать текст.");

      // Fetch the fresh list ourselves: the state update from loadMyLessons
      // lands too late for this same handler to use.
      const listRes = await freshFetch("/api/lessons", { headers: await sbAuthHeaders() });
      const listData = await listRes.json() as { lessons?: SharedBook[] };
      const lessons = listData.lessons ?? [];
      setMyLessons(lessons);
      const lesson = lessons.find((l) => l.id === data.id);
      setDictWord(null);
      if (lesson) {
        await openSharedLesson(lesson, lessons);
      } else {
        showToast("Текст создан — смотрите в «Мои уроки»");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Не удалось создать текст.");
    } finally {
      setMiniTextBusy(false);
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
    if (activeTab === "dictionary") {
      void loadDictionary();
    }
  }, [activeTab, loadSharedBooks, loadMyLessons, loadLessonProgress, loadDictionary]);

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
      onlyComfortable,
    };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [activeTab, language, cefrLangFilter, cefrLevelFilter, cefrStatusFilter, klexLevelFilter, klexStatusFilter, collapsedLevels, composer.level, composer.length, klexikonOffset, onlyComfortable]);

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
        {(["classic", "klexikon", "cefr", "lessons", "dictionary"] as const).map((tab) => (
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
            {tab === "dictionary" && <BookA size={15} />}
            {TAB_LABELS[tab]}
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

      {/* ── Dictionary: the learner's own words ─────────────────────────────── */}
      {activeTab === "dictionary" && (
        <>
          {!user ? (
            <div className="seed-card">
              <BookA size={42} style={{ color: "var(--accent)" }} />
              <h3>Войдите, чтобы вести словарь</h3>
              <p>Слова сохраняются в вашем аккаунте и видны только вам.</p>
            </div>
          ) : (
            <>
              <DictionaryPanel
                entries={dictionary}
                batches={dictBatches}
                cards={cards}
                isLoading={dictLoading}
                error={dictError}
                language={profile.targetLanguage}
                onPhotograph={() => { setPhotoMode("dictionary"); setPhotoOpen(true); }}
                onOpenEntry={(entry) => void openDictWord(entry)}
                onDeleteEntry={(id) => void deleteDictionaryEntry(id)}
                onDeleteBatch={(id) => void deleteDictionaryBatch(id)}
                onTrainBatch={(batch) => onTrainWords?.(batch)}
                onCreateFromPack={openComposerForPack}
              />
              <button
                type="button"
                className="add-lesson-fab"
                onClick={() => { setPhotoMode("dictionary"); setPhotoOpen(true); }}
                aria-label="Сфотографировать слова"
                title="Сфотографировать слова"
              >
                <Camera size={22} />
              </button>
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
                      onRefine={() => openRefine(lesson.id)}
                    />
                  ))}
                </div>
              )}

              {/* Both within thumb reach: photograph a text, or write a topic */}
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
            void loadDictionary();
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

      {/* A dictionary word opens the same word modal as everywhere else. */}
      {dictWord && (
        <WordModal
          analysis={dictWord.analysis}
          isOpen
          lang={profile.targetLanguage}
          nativeLang={profile.nativeLanguage}
          selectedWord={dictWord.entry.headword}
          onClose={() => setDictWord(null)}
          onAddCard={() => addCardFromEntry(dictWord.entry)}
          onAddExample={(text, translation) => {
            if (onAddCard) {
              const srs = createDefaultSrsFields(null, "Словарь");
              onAddCard({ id: `card-${Date.now()}`, type: "phrase", source: "Словарь", addedAt: new Date().toISOString(), ...srs, front: text, back: translation });
              showToast("✓ Карточка добавлена");
            }
          }}
          onCreateText={() => void createMiniTextForWord(dictWord.entry)}
          isCreatingText={miniTextBusy}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
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
  /** Null when the text has no frequency data yet — the badge is then hidden. */
  coverage?: Coverage | null;
  onOpen: () => void;
  /** Only generated lessons can be removed or revised — public content is shared. */
  onDelete?: () => void;
  onRefine?: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  klexikon: "Klexikon",
  universal_cefr: "UniversalCEFR",
  generated: "ИИ",
  oersi: "OERSI",
};

function SyllabusItem({ book, progress, isLoading, showLang, coverage, onOpen, onDelete, onRefine }: SyllabusItemProps) {
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
        {/* A generated document says which of the two it is: reading a text and
            working through a lesson are different intentions, and the list is
            where they are told apart. */}
        <span>
          {isGenerated
            ? book.metadata?.lesson_kind === "lesson" ? "Урок" : "Текст"
            : SOURCE_LABELS[book.source_type] ?? book.source_type}
        </span>
        {coverage && (
          <span
            className={`coverage-chip${coverage.isComfortable ? " fits" : ""}`}
            title={
              coverage.isComfortable
                ? "Примерно одно слово из десяти новое — хорошая нагрузка для чтения"
                : `Знакомо ${Math.round(coverage.ratio * 100)}% слов текста`
            }
          >
            {coverage.isComfortable && "✓ "}{Math.round(coverage.ratio * 100)}% слов
          </span>
        )}
        {progress && progress.status !== "not_started" && (
          <span style={{ color: status === "completed" ? "#7aab6a" : "var(--accent)" }}>
            {status === "completed" ? "✓ Пройдено" : `${Math.round(progress.percentage)}%`}
          </span>
        )}
        {/* Up here rather than in the action row: three buttons do not fit a
            phone width, and delete is the rarest of them. */}
        {onDelete && (
          <button type="button" className="syllabus-delete" onClick={onDelete} title="Удалить урок" aria-label="Удалить урок">
            <Trash2 size={13} />
          </button>
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
            <><PlayCircle size={13} />{isGenerated && book.metadata?.lesson_kind === "lesson" ? "Начать урок" : "Читать"}</>
          )}
        </button>
        {onRefine && (
          <button
            type="button"
            className="mini-btn syllabus-refine"
            onClick={onRefine}
            title="Изменить: правки, другой объём"
          >
            <Pencil size={13} />Изменить
          </button>
        )}
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
  /* Both lesson forms live inside a modal now, which already provides the
     frame — so this is just the vertical rhythm. */
  .lesson-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Keeps the primary button off the bottom edge of the sheet. */
    padding-bottom: 20px;
  }

  /* Floating "+" that opens the composer. Sits above the bottom nav (which is
     12px from the bottom and ~52px tall) and tracks the right edge of the
     640px content column on wide screens, falling back to a 16px inset on
     phones. */
  .add-lesson-fab {
    position: fixed;
    right: max(16px, calc(50% - 304px));
    bottom: 78px;
    z-index: 25;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-dark);
    box-shadow: 0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,168,71,0.35);
    transition: transform var(--transition-fast), background var(--transition-fast);
  }
  .add-lesson-fab:hover { background: var(--accent-bright); }
  .add-lesson-fab:active { transform: scale(0.92); }
  /* Sits directly above the primary one, smaller so the hierarchy is obvious. */
  .add-lesson-fab.secondary {
    bottom: 140px;
    width: 44px;
    height: 44px;
    background: rgba(39,35,25,0.96);
    color: var(--accent);
    box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 0 1px rgba(212,168,71,0.35);
  }
  .add-lesson-fab.secondary:hover { background: rgba(212,168,71,0.18); }

  /* "You already know N% of the words here" — the closer to the comfort band,
     the more useful the text, so the band gets the accent colour. */
  .coverage-chip {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-weight: 700;
    letter-spacing: 0;
    text-transform: none;
  }
  .coverage-chip.fits {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.14);
    color: #8fbf7f;
  }

  .fits-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transition: all var(--transition-fast);
  }
  .fits-toggle:hover { color: var(--text-primary); }
  .fits-toggle.on {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.14);
    color: #8fbf7f;
  }

  .refine-target {
    margin: 0;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: rgba(240,230,211,0.04);
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
  }
  /* Step one of the composer: which of the two documents this is going to be.
     Two cards rather than a toggle, because the difference is what each one
     produces, and that needs a sentence to say. */
  .lesson-kind-picker { display: flex; flex-direction: column; gap: 10px; }
  .lesson-kind-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated, rgba(0,0,0,0.2));
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: all 0.18s ease;
  }
  .lesson-kind-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .lesson-kind-card svg { color: var(--accent); }
  .lesson-kind-card strong { font-size: 15px; font-weight: 850; }
  .lesson-kind-card span { font-size: 12.5px; line-height: 1.45; color: var(--text-muted); }

  /* The pack a text or lesson is being built from, and the brief behind it. */
  .lesson-pack-note {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: 9px;
    background: rgba(212,168,71,0.06);
  }
  .lesson-pack-note strong { font-size: 12.5px; font-weight: 800; }
  .lesson-pack-note span { font-size: 11.5px; line-height: 1.45; color: var(--text-muted); }

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
  .lesson-field textarea {
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

  .syllabus-refine { gap: 4px; color: var(--text-muted); background: rgba(240,230,211,0.05); }
  .syllabus-refine:hover { color: var(--accent); }
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
    display: flex;
    align-items: center;
    margin-left: auto;
    padding: 2px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    opacity: 0.7;
    transition: color var(--transition-fast), opacity var(--transition-fast);
  }
  .syllabus-delete:hover { color: #d98080; opacity: 1; }

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
    /* The card is align-items: flex-start, so without this the row shrinks to
       its content and the delete button cannot push itself to the right edge. */
    width: 100%;
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

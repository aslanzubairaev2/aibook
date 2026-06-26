"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Search, Trash2, Flame, Calendar, CheckCircle2, RotateCcw, AlertCircle, Play, Layers, ChevronDown, MessageCircle, SlidersHorizontal, Volume2 } from "lucide-react";
import type { AiAnalysis, CardFilters, DiscussMessage, Flashcard, TrainVariant, TtsProvider } from "@/lib/types";
import { calculateSM2, createDefaultSrsFields, createDefaultSkillProgress } from "@/lib/srs/sm2";
import { findDuplicateCard } from "@/lib/cards";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { speak } from "@/lib/tts";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey, makeDiscussCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis, getLocalProfile, saveLocalProfile, getSrsSession, saveSrsSession, clearSrsSession, getLocalDiscussHistory, saveLocalDiscussHistory, getCardVariantState, saveCardVariantProgress } from "@/lib/db/local";
import { sbInsertFlashcard, sbGetDiscussHistory, sbSaveDiscussHistory, sbUpsertSettings } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { WordModal } from "@/components/word-modal/WordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { ProductiveTrainer } from "@/components/cards/ProductiveTrainer";
import { SkillBadges } from "@/components/cards/SkillBadges";

type Props = {
  cards: Flashcard[];
  onBack: () => void;
  onAddCard: (card: Flashcard) => void;
  onUpdateCard: (card: Flashcard) => void;
  onDeleteCard: (id: string) => void;
};

type FilterStatus = "all" | "new" | "learning" | "review" | "relearning";
type FilterType = "all" | "word" | "phrase" | "sentence";
type TrainStatus = "all" | "new" | "learning" | "review" | "relearning" | "hard";
type SortOrder = "added" | "due" | "ease";
type TrainQueueItem = { card: Flashcard; variant: TrainVariant };
type VariantProgressLike = { status: Flashcard["status"]; repetitions: number; lapses: number; intervalDays: number; easeFactor: number; dueAt: string };

const TYPE_LABELS = { word: "Слово", phrase: "Фраза", sentence: "Предложение" } as const;

const TRAIN_STATUS_LABELS: Record<Exclude<TrainStatus, "all">, string> = {
  new: "Новые",
  learning: "Обучение",
  review: "Повторение",
  relearning: "Переучивание",
  hard: "Сложные",
};

// "forward" = изучаемый → родной (классическое узнавание), "reverse" = родной → изучаемый
// (вспомнить, как сказать), "audio" = услышать на слух и вспомнить. Каждый вариант
// планируется независимо — см. getVariantProgress — так что оценка в одном направлении
// не влияет на то, когда карточка появится в другом.
const TRAIN_VARIANT_LABELS: Record<TrainVariant, string> = {
  forward: "Изучаемый → Родной",
  reverse: "Родной → Изучаемый",
  audio: "Аудио",
};
const DEFAULT_TRAIN_VARIANTS: TrainVariant[] = ["forward"];

// "Hard" cards: repeatedly forgotten (lapses) or with a low ease factor —
// the ones the user struggles to memorize. Trained regardless of due date.
function isHardProgress(p: { lapses: number; repetitions: number; easeFactor: number }): boolean {
  return p.lapses >= 2 || (p.repetitions > 0 && p.easeFactor <= 2.2);
}
function isHardCard(c: Flashcard): boolean {
  return isHardProgress(c);
}

// The base Flashcard SM-2 fields are the "forward" variant's progress;
// "reverse"/"audio" get their own independent schedule from local storage.
function getVariantProgress(card: Flashcard, variant: TrainVariant): VariantProgressLike {
  if (variant === "forward") {
    return { status: card.status, repetitions: card.repetitions, lapses: card.lapses, intervalDays: card.intervalDays, easeFactor: card.easeFactor, dueAt: card.dueAt };
  }
  return getCardVariantState(card.id)[variant] ?? createDefaultSkillProgress();
}

const TTS_PROVIDERS: { value: TtsProvider; label: string }[] = [
  { value: "local", label: "Браузер" },
  { value: "gemini", label: "Gemini TTS" },
  { value: "deepgram", label: "Deepgram" },
];

export function CardsView({ cards, onBack, onAddCard, onUpdateCard, onDeleteCard }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(getLocalProfile);
  const targetLanguage = profile.targetLanguage;
  const nativeLanguage = profile.nativeLanguage;

  const savedFilters = profile.cardFilters;

  const [activeTab, setActiveTab] = useState<"today" | "train" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(savedFilters?.filterStatus ?? "all");
  const [filterType, setFilterType] = useState<FilterType>(savedFilters?.filterType ?? "all");
  const [filterBook, setFilterBook] = useState<string>(savedFilters?.filterBook ?? "all");
  const [sortOrder, setSortOrder] = useState<SortOrder>(savedFilters?.sortOrder ?? "added");
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showTrainFilterPanel, setShowTrainFilterPanel] = useState(false);
  const [showTtsMenu, setShowTtsMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Training state
  const [currentTrainIndex, setCurrentTrainIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [trainFilter, setTrainFilter] = useState<FilterType>(savedFilters?.trainFilter ?? "all");
  const [trainStatus, setTrainStatus] = useState<TrainStatus>(savedFilters?.trainStatus ?? "all");
  const [trainVariants, setTrainVariants] = useState<TrainVariant[]>(savedFilters?.trainVariants?.length ? savedFilters.trainVariants : DEFAULT_TRAIN_VARIANTS);
  const [trainMode, setTrainMode] = useState<"recognize" | "active">(savedFilters?.trainMode ?? "recognize");
  // Snapshot of the cards being trained this session — built once per session
  // start/filter change rather than re-derived from the (mutating) `cards`
  // prop on every render, so grading a card can't shrink the queue out from
  // under `currentTrainIndex` mid-session.
  const [trainQueue, setTrainQueue] = useState<TrainQueueItem[]>([]);

  // Discuss-with-AI state (chat about a specific card)
  const [discuss, setDiscuss] = useState<{
    open: boolean;
    card: Flashcard | null;
    cacheKey: string;
    messages: DiscussMessage[];
    historyLoading: boolean;
  }>({ open: false, card: null, cacheKey: "", messages: [], historyLoading: false });

  // Word modal state
  const [wordModal, setWordModal] = useState<{
    open: boolean;
    word: string;
    analysis: AiAnalysis | null;
    loading: boolean;
  }>({ open: false, word: "", analysis: null, loading: false });

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination for "All Cards"
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // --- Stats ---
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndTime = todayEnd.getTime();

  const dueCards = cards.filter((c) => {
    return c.status === "new" || new Date(c.dueAt).getTime() <= todayEndTime;
  });

  const learnedCount = cards.filter((c) => c.repetitions > 0).length;

  const calculateStreak = (cardsList: Flashcard[]): number => {
    const reviewedDates = new Set<string>();
    cardsList.forEach((c) => {
      if (c.lastReviewedAt) reviewedDates.add(new Date(c.lastReviewedAt).toDateString());
    });
    let streak = 0;
    const checkDate = new Date();
    if (reviewedDates.has(checkDate.toDateString())) {
      while (reviewedDates.has(checkDate.toDateString())) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
    } else {
      checkDate.setDate(checkDate.getDate() - 1);
      while (reviewedDates.has(checkDate.toDateString())) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
    }
    return streak;
  };

  const streak = calculateStreak(cards);

  // --- Restore SRS session when dueCards become available ---
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    if (dueCards.length === 0) return;
    const saved = getSrsSession();
    if (saved && saved.reviewedIds.length > 0) {
      sessionRestoredRef.current = true;
      const queue = buildTrainQueue(trainStatus, trainFilter, trainVariants);
      setTrainQueue(queue);
      setReviewedIds(saved.reviewedIds);
      setCurrentTrainIndex(Math.min(saved.currentIndex, queue.length));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueCards.length]);

  // --- Auto-play audio-variant cards as they come up ---
  useEffect(() => {
    const item = trainQueue[currentTrainIndex];
    if (item?.variant === "audio") void speak(item.card.front, targetLanguage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainQueue, currentTrainIndex]);

  // --- Infinite scroll for All Cards ---
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((n) => n + 50); },
      { rootMargin: "200px" }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [activeTab]);

  // --- Close menus on outside click ---
  // Checks the click target against the toggle/panel itself (rather than
  // relying on the button's stopPropagation to outrun this document-level
  // listener) — a plain native listener on `document` still observes clicks
  // on elements inside React's tree, so an unconditional close-on-any-click
  // here was undoing the toggle button's own state update on the very same
  // click that opened it.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".all-filter-toggle, .all-filter-panel")) {
        setShowFilterPanel(false);
        setShowTrainFilterPanel(false);
      }
      if (!target.closest(".card-tts-wrap")) setShowTtsMenu(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  // --- Add card (from WordModal / Discuss chat) with duplicate control ---
  async function addCard(front: string, back: string, type: Flashcard["type"], sourceCard?: Flashcard | null) {
    if (!front.trim() || !back.trim()) return;

    if (findDuplicateCard(front, cards)) {
      showToast("Такая карточка уже добавлена");
      return;
    }

    const sourceTitle = sourceCard?.sourceBookTitle ?? sourceCard?.source ?? "Тренажёр";
    const srsFields = createDefaultSrsFields(sourceCard?.sourceBookId ?? null, sourceTitle);
    const localCard: Flashcard = {
      id: `card-${Date.now()}`,
      type,
      source: sourceTitle,
      addedAt: new Date().toISOString(),
      ...srsFields,
      front,
      back,
    };
    if (user) {
      const dbId = await sbInsertFlashcard({
        user_id: user.id,
        vocabulary_item_id: null,
        front: localCard.front,
        back: localCard.back,
        source_book_title: sourceTitle,
        selection_type: type,
        repetitions: srsFields.repetitions,
        lapses: srsFields.lapses,
        easiness_factor: srsFields.easeFactor,
        interval_days: srsFields.intervalDays,
        next_review_at: srsFields.dueAt,
        last_reviewed_at: srsFields.lastReviewedAt,
        source_book_id: srsFields.sourceBookId,
        status: srsFields.status,
      });
      if (dbId) localCard.id = dbId;
    }

    onAddCard(localCard);
    showToast("✓ Карточка добавлена");
  }

  // --- Training (cards filtered by status and type) ---
  // "hard" draws from ALL cards (not just due today) so problem cards can be
  // drilled any time; the rest filter today's due queue by SRS status.
  // This pool is only used to show live counts on the filter chips before a
  // session starts — the actual training queue is a separate snapshot (see
  // `buildTrainQueue`/`trainQueue` below) so it doesn't shrink mid-session.
  // Each selected variant (forward/reverse/audio) carries its own independent
  // schedule (see getVariantProgress), so a card can be due in one variant and
  // produces its own queue item per due variant rather than a single coin-flip.
  function buildTrainQueue(status: TrainStatus, filter: FilterType, variants: TrainVariant[]): TrainQueueItem[] {
    const typed = filter === "all" ? cards : cards.filter((c) => c.type === filter);
    const items: TrainQueueItem[] = [];
    for (const card of typed) {
      for (const variant of variants) {
        const p = getVariantProgress(card, variant);
        if (status === "hard") {
          if (isHardProgress(p)) items.push({ card, variant });
          continue;
        }
        const due = p.status === "new" || new Date(p.dueAt).getTime() <= todayEndTime;
        if (!due) continue;
        if (status !== "all" && p.status !== status) continue;
        items.push({ card, variant });
      }
    }
    // Shuffle so multi-variant sessions interleave instead of running all of
    // one variant before the next.
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  const trainPool = buildTrainQueue(trainStatus, "all", trainVariants);

  function startTrainingSession(status: TrainStatus, filter: FilterType, variants: TrainVariant[]) {
    setTrainQueue(buildTrainQueue(status, filter, variants));
    setCurrentTrainIndex(0);
    setReviewedIds([]);
    setIsFlipped(false);
    clearSrsSession();
  }

  const handleGrade = (score: 1 | 2 | 3 | 4) => {
    if (trainQueue.length === 0 || currentTrainIndex >= trainQueue.length) return;
    const { card, variant } = trainQueue[currentTrainIndex];
    const prev = getVariantProgress(card, variant);
    const srsUpdate = calculateSM2(score, prev.repetitions, prev.lapses, prev.intervalDays, prev.easeFactor);
    const now = new Date().toISOString();
    if (variant === "forward") {
      onUpdateCard({ ...card, ...srsUpdate, lastReviewedAt: now });
    } else {
      saveCardVariantProgress(card.id, variant, { ...srsUpdate, lastReviewedAt: now });
      // Bump lastReviewedAt only, so the streak counter sees today's activity
      // without disturbing the forward variant's own SRS fields.
      onUpdateCard({ ...card, lastReviewedAt: now });
    }

    const nextReviewedIds = [...reviewedIds, card.id];
    const nextIndex = currentTrainIndex + 1;
    setReviewedIds(nextReviewedIds);
    saveSrsSession(nextReviewedIds, nextIndex);

    setIsFlipped(false);
    setTimeout(() => setCurrentTrainIndex(nextIndex), 250);
  };

  const restartTraining = () => startTrainingSession(trainStatus, trainFilter, trainVariants);

  // Persists a filter/sort change to the local profile and, for signed-in users,
  // to user_settings — so selections survive reloads and follow the user across devices.
  const persistCardFilters = useCallback((patch: Partial<CardFilters>) => {
    setProfile((prev) => {
      const updatedFilters = { ...prev.cardFilters, ...patch };
      const updated = { ...prev, cardFilters: updatedFilters };
      saveLocalProfile(updated);
      if (user) {
        void sbUpsertSettings({
          user_id: user.id,
          native_language: updated.nativeLanguage,
          active_target_lang: updated.targetLanguage,
          ui_language: updated.uiLanguage,
          tts_provider: updated.ttsProvider ?? "local",
          reading_minutes: updated.readingMinutes,
          books_started: updated.booksStarted,
          books_finished: updated.booksFinished,
          updated_at: new Date().toISOString(),
          card_filters: updatedFilters,
        });
      }
      return updated;
    });
  }, [user]);

  // --- TTS provider change ---
  const handleTtsProviderChange = (provider: TtsProvider, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...profile, ttsProvider: provider };
    saveLocalProfile(updated);
    setProfile(updated);
    setShowTtsMenu(false);
  };

  // Long press on TTS button area → show provider menu
  const handleTtsPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    longPressRef.current = setTimeout(() => setShowTtsMenu(true), 500);
  };
  const handleTtsPointerUp = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  // --- Discuss with AI about a card ---
  async function openDiscussForCard(card: Flashcard) {
    const cacheKey = makeDiscussCacheKey(card.type, card.front, targetLanguage, nativeLanguage);
    const history = getLocalDiscussHistory(cacheKey);
    setDiscuss({ open: true, card, cacheKey, messages: history, historyLoading: Boolean(user) });

    if (!user) return;
    try {
      const remoteHistory = await sbGetDiscussHistory(user.id, cacheKey);
      if (remoteHistory && remoteHistory.length > 0) {
        saveLocalDiscussHistory(cacheKey, remoteHistory);
        setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, messages: remoteHistory, historyLoading: false } : prev));
      } else {
        setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, historyLoading: false } : prev));
      }
    } catch {
      setDiscuss((prev) => (prev.cacheKey === cacheKey ? { ...prev, historyLoading: false } : prev));
    }
  }

  function handleDiscussMessagesChange(messages: DiscussMessage[]) {
    setDiscuss((prev) => ({ ...prev, messages }));
    if (discuss.cacheKey) {
      saveLocalDiscussHistory(discuss.cacheKey, messages);
      if (user) void sbSaveDiscussHistory(user.id, discuss.cacheKey, messages);
    }
  }

  // --- Word tap → WordModal ---
  const openWordModalFor = useCallback(async (word: string) => {
    const norm = normalizeToken(word);
    if (!norm) return;

    // Open modal immediately with loading state
    setWordModal({ open: true, word: norm, analysis: null, loading: true });

    const cacheKey = makeAiCacheKey("word", norm, targetLanguage, nativeLanguage);
    const cached = getLocalAiAnalysis(cacheKey);
    if (cached?.word?.translation) {
      setWordModal({ open: true, word: norm, analysis: cached, loading: false });
      return;
    }

    try {
      const result = await analyzeSelection({
        mode: "word",
        word: norm,
        text: norm,
        sentence: norm,
        sentenceBefore: "",
        sentenceAfter: "",
        nativeLanguage,
        targetLanguage,
      });
      saveLocalAiAnalysis(cacheKey, result);
      setWordModal({ open: true, word: norm, analysis: result, loading: false });
    } catch {
      setWordModal({ open: true, word: norm, analysis: null, loading: false });
    }
  }, [targetLanguage, nativeLanguage]);

  const handleWordTap = useCallback((word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void openWordModalFor(word);
  }, [openWordModalFor]);

  // --- Tokenized card text ---
  const TokenizedText = ({ text, style }: { text: string; style?: React.CSSProperties }) => {
    const tokens = splitIntoTokens(text);
    return (
      <div style={style}>
        {tokens.map((tok, i) => {
          const norm = normalizeToken(tok);
          if (!norm) return <span key={i}>{tok}</span>;
          return (
            <span
              key={i}
              onClick={(e) => handleWordTap(tok, e)}
              style={{ cursor: "pointer", borderRadius: 2, transition: "background 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212, 168, 71, 0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {tok}
            </span>
          );
        })}
      </div>
    );
  };

  // --- Dynamic font size for card text ---
  function cardFontSize(text: string): string {
    if (text.length > 200) return "13px";
    if (text.length > 120) return "15px";
    if (text.length > 60) return "18px";
    return "22px";
  }

  // --- All Cards filtering & sorting ---
  const allBooks = Array.from(new Set(cards.map((c) => c.sourceBookTitle || c.source || "").filter(Boolean)));
  const activeFilterCount = [filterStatus !== "all", filterType !== "all", filterBook !== "all"].filter(Boolean).length;
  const variantsAreDefault = trainVariants.length === 1 && trainVariants[0] === "forward";
  const activeTrainFilterCount = [trainFilter !== "all", trainStatus !== "all", !variantsAreDefault].filter(Boolean).length;

  const filteredAllCards = cards
    .filter((c) => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterType !== "all" && c.type !== filterType) return false;
      if (filterBook !== "all" && (c.sourceBookTitle || c.source || "") !== filterBook) return false;
      const query = searchQuery.toLowerCase().trim();
      if (query) return c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query) || (c.sourceBookTitle || c.source || "").toLowerCase().includes(query);
      return true;
    })
    .sort((a, b) => {
      if (sortOrder === "due") return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (sortOrder === "ease") return a.easeFactor - b.easeFactor;
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });

  const visibleCards = filteredAllCards.slice(0, visibleCount);

  const STATUS_COLORS: Record<string, string> = {
    new: "var(--accent)",
    learning: "var(--blue)",
    review: "var(--green)",
    relearning: "#e08888",
  };

  const STATUS_LABELS: Record<string, string> = {
    new: "Новые",
    learning: "Обучение",
    review: "Повторение",
    relearning: "Переучивание",
  };

  const currentItem = trainQueue[currentTrainIndex];
  const currentCard = currentItem?.card as Flashcard;
  const currentVariant: TrainVariant = currentItem?.variant ?? "forward";
  const isReversed = currentVariant === "reverse";
  const isAudio = currentVariant === "audio";
  const promptText = isReversed ? currentCard?.back : currentCard?.front;
  const answerText = isReversed ? currentCard?.front : currentCard?.back;
  const promptLang = isReversed ? nativeLanguage : targetLanguage;
  const currentProgress = currentCard ? getVariantProgress(currentCard, currentVariant) : null;

  return (
    <section className="screen" onClick={() => { setShowFilterPanel(false); setShowTtsMenu(false); }}>
      <style>{`
        .srs-sticky-header { position: sticky; top: 0; z-index: 30; margin: -20px -16px 16px; padding: 16px 16px 10px; background: var(--bg-primary); border-bottom: 1px solid var(--border); }
        @media (min-width: 640px) { .srs-sticky-header { margin: -28px -24px 16px; padding: 24px 24px 10px; } }
        .srs-tabs-container { display: flex; gap: 4px; padding: 4px; margin-bottom: 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .srs-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 4px; background: transparent; border: none; border-radius: var(--radius-md); font-weight: 700; font-size: 13px; color: var(--text-muted); transition: all 0.2s; cursor: pointer; }
        .srs-tab.active { color: var(--accent); background: var(--bg-card); box-shadow: var(--shadow-sm); }
        .srs-tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 10px; font-weight: 800; }
        .srs-tab-badge.empty { background: rgba(240, 230, 211, 0.08); color: var(--text-muted); }
        .srs-tab.active .srs-tab-badge:not(.empty) { background: var(--accent); color: var(--bg-primary); }
        .srs-stats-banner { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
        .srs-stat-mini { display: flex; align-items: center; gap: 5px; }
        .srs-stat-mini .srs-stat-val { font-size: 14px; font-weight: 900; line-height: 1; display: flex; align-items: center; gap: 3px; }
        .srs-stat-mini .srs-stat-lbl { font-size: 10px; color: var(--text-muted); font-weight: 700; white-space: nowrap; }
        .srs-stat-divider { width: 1px; height: 16px; background: var(--border); flex-shrink: 0; }
        .mode-switch { display: inline-flex; padding: 3px; gap: 2px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 999px; }
        .mode-switch-opt { padding: 6px 14px; border-radius: 999px; border: none; background: transparent; font-size: 13px; font-weight: 700; color: var(--text-muted); cursor: pointer; transition: all 0.2s; }
        .mode-switch-opt.active { background: var(--accent); color: var(--bg-primary); }
        .audio-prompt { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .audio-play-btn { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; border: 1px solid var(--accent); background: rgba(212, 168, 71, 0.12); color: var(--accent); cursor: pointer; transition: all 0.2s; }
        .audio-play-btn:active { transform: scale(0.94); }
        .audio-prompt-lbl { font-size: 12px; color: var(--text-muted); font-weight: 700; }
        .flipper-perspective { perspective: 1000px; width: 100%; max-width: 420px; margin: 0 auto 16px; }
        .flipper-card { width: 100%; position: relative; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; }
        .flipper-card.flipped { transform: rotateY(180deg); }
        .flipper-face { width: 100%; backface-visibility: hidden; border-radius: var(--radius-lg); border: 1px solid var(--border-strong); display: flex; flex-direction: column; padding: 18px 18px 14px; box-shadow: var(--shadow-sm); overflow: hidden; min-height: 180px; gap: 8px; }
        .flipper-face-back { position: absolute; top: 0; left: 0; }
        .flipper-face-front { background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(212, 168, 71, 0.04) 100%); }
        .flipper-face-back { background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(122, 171, 106, 0.04) 100%); transform: rotateY(180deg); }
        .card-face-row { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .card-text-area { flex: 1; display: flex; align-items: center; justify-content: center; padding: 8px 0; overflow: hidden; word-break: break-word; text-align: center; }
        .card-footer-row { display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
        .card-footer-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
        .card-tts-wrap { position: relative; flex-shrink: 0; }
        .tts-menu { position: absolute; top: calc(100% + 6px); right: 0; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 4px; z-index: 200; min-width: 130px; box-shadow: var(--shadow-sm); }
        .tts-menu-item { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-primary); transition: background 0.15s; white-space: nowrap; }
        .tts-menu-item:hover { background: var(--bg-elevated); }
        .tts-menu-item.active { color: var(--accent); }
        .srs-grade-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 100%; max-width: 420px; margin: 0 auto; }
        .grade-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 4px; border: 1px solid var(--border); border-radius: var(--radius-md); font-weight: 700; font-size: 12px; cursor: pointer; background: var(--bg-elevated); transition: all 0.2s; color: var(--text-primary); }
        .grade-btn:active { transform: scale(0.96); }
        .grade-btn-1 { border-color: rgba(224, 136, 136, 0.3); }
        .grade-btn-1:hover, .grade-btn-1:active { background: rgba(224, 136, 136, 0.1); border-color: #e08888; }
        .grade-btn-2 { border-color: rgba(106, 152, 196, 0.3); }
        .grade-btn-2:hover, .grade-btn-2:active { background: rgba(106, 152, 196, 0.1); border-color: var(--blue); }
        .grade-btn-3 { border-color: rgba(122, 171, 106, 0.3); }
        .grade-btn-3:hover, .grade-btn-3:active { background: rgba(122, 171, 106, 0.1); border-color: var(--green); }
        .grade-btn-4 { border-color: rgba(212, 168, 71, 0.3); }
        .grade-btn-4:hover, .grade-btn-4:active { background: rgba(212, 168, 71, 0.1); border-color: var(--accent); }
        .grade-score { font-size: 15px; font-weight: 900; margin-bottom: 2px; }
        .grade-lbl { font-size: 10px; color: var(--text-muted); }
        .grade-btn-1 .grade-score { color: #e08888; }
        .grade-btn-2 .grade-score { color: var(--blue); }
        .grade-btn-3 .grade-score { color: var(--green); }
        .grade-btn-4 .grade-score { color: var(--accent); }
        .all-search-bar { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--bg-card); border-radius: var(--radius-sm); padding: 0 12px; height: 40px; margin-bottom: 12px; min-width: 0; }
        .all-search-input { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text-primary); outline: none; font-size: 14px; }
        .card-row-delete-btn { color: var(--text-muted); background: transparent; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
        .card-row-delete-btn:hover { color: #e08888; background: rgba(224, 136, 136, 0.08); }
        .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .filter-chip { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.2s; white-space: nowrap; }
        .filter-chip.active { background: rgba(212, 168, 71, 0.15); border-color: var(--accent); color: var(--accent); }
        .book-select { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; color: var(--text-muted); font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; outline: none; max-width: 220px; }
        .book-select:focus { border-color: var(--accent); color: var(--accent); }
        .all-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .all-toolbar .all-search-bar { flex: 1; margin-bottom: 0; }
        .all-filter-toggle { display: flex; align-items: center; gap: 6px; padding: 0 14px; height: 40px; flex-shrink: 0; white-space: nowrap; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .all-filter-toggle.active { border-color: var(--accent); color: var(--accent); }
        .all-filter-count { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: var(--bg-primary); font-size: 10px; font-weight: 800; }
        .all-filter-panel { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm); }
        .filter-group-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
        .filter-reset-btn { align-self: flex-start; font-size: 12px; font-weight: 700; color: var(--text-muted); background: transparent; border: none; cursor: pointer; padding: 4px 0; text-decoration: underline; }
        .filter-reset-btn:hover { color: var(--accent); }
      `}</style>

      {/* Word Modal */}
      <WordModal
        analysis={wordModal.analysis}
        isOpen={wordModal.open}
        isLoading={wordModal.loading}
        lang={targetLanguage}
        nativeLang={nativeLanguage}
        selectedWord={wordModal.word}
        onClose={() => setWordModal((s) => ({ ...s, open: false }))}
        onAddCard={() => void addCard(wordModal.word, wordModal.analysis?.word?.translation ?? "", "word")}
        onAddLemma={(lemma) => void addCard(lemma, wordModal.analysis?.word?.translation ?? "", "word")}
        onWordTap={(word) => void openWordModalFor(word)}
        onAddExample={(text, translation) => void addCard(text, translation, "phrase")}
      />

      {/* Discuss with AI about a card */}
      {discuss.card && (
        <DiscussAiModal
          isOpen={discuss.open}
          isHistoryLoading={discuss.historyLoading}
          mode={discuss.card.type}
          selectedText={discuss.card.front}
          sentence={discuss.card.front}
          nativeLanguage={nativeLanguage}
          targetLanguage={targetLanguage}
          messages={discuss.messages}
          onMessagesChange={handleDiscussMessagesChange}
          onClose={() => setDiscuss((prev) => ({ ...prev, open: false }))}
          onWordTap={(word) => void openWordModalFor(word)}
          onAddExample={(text, translation) => void addCard(text, translation, "phrase", discuss.card)}
        />
      )}

      {/* Screen Header — stays pinned while the card lists scroll */}
      <header className="screen-header srs-sticky-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Интервальное повторение</p>
          <h1>SRS Тренажер</h1>
        </div>
        <button className="icon-btn" onClick={() => setActiveTab("all")} type="button" aria-label="Все карточки">
          <Layers size={20} />
        </button>
      </header>

      {/* Stats Banner */}
      <div className="srs-stats-banner">
        <div className="srs-stat-mini">
          <span className="srs-stat-val" style={{ color: "var(--accent)" }}>{dueCards.length}</span>
          <span className="srs-stat-lbl">сегодня</span>
        </div>
        <div className="srs-stat-divider" />
        <div className="srs-stat-mini">
          <span className="srs-stat-val" style={{ color: streak > 0 ? "var(--accent)" : "var(--text-muted)" }}>
            <Flame size={13} fill={streak > 0 ? "var(--accent)" : "none"} />
            {streak}
          </span>
          <span className="srs-stat-lbl">серия</span>
        </div>
        <div className="srs-stat-divider" />
        <div className="srs-stat-mini">
          <span className="srs-stat-val" style={{ color: "var(--green)" }}>{learnedCount}</span>
          <span className="srs-stat-lbl">изучено</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="srs-tabs-container">
        <button className={`srs-tab ${activeTab === "today" ? "active" : ""}`} onClick={() => setActiveTab("today")} type="button">
          Сегодня
          <span className={`srs-tab-badge ${dueCards.length === 0 ? "empty" : ""}`}>{dueCards.length}</span>
        </button>
        <button
          className={`srs-tab ${activeTab === "train" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("train");
            if (trainQueue.length === 0 || currentTrainIndex >= trainQueue.length) restartTraining();
          }}
          type="button"
        >
          Тренировка
        </button>
        <button className={`srs-tab ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")} type="button">
          Все карточки
          <span className="srs-tab-badge empty">{cards.length}</span>
        </button>
      </div>

      {/* TAB: TODAY */}
      {activeTab === "today" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {dueCards.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
              <strong>Вы полностью свободны!</strong>
              <p>На сегодня все карточки успешно повторены. Отдыхайте или читайте новые книги.</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                  К повторению ({dueCards.length}):
                </span>
                <button className="pill-btn" onClick={() => { restartTraining(); setActiveTab("train"); }} type="button">
                  <Play size={14} fill="currentColor" /> Начать тренировку
                </button>
              </div>
              <div className="card-list">
                {dueCards.map((card) => (
                  <div key={card.id} className="flash-card" style={{ borderLeft: `4px solid ${STATUS_COLORS[card.status] ?? "var(--accent)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <span className={`flash-card-type ${card.type}`}>{TYPE_LABELS[card.type]}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <SkillBadges cardId={card.id} />
                        <span style={{ fontSize: 10, background: `${STATUS_COLORS[card.status] ?? "var(--accent)"}18`, color: STATUS_COLORS[card.status] ?? "var(--accent)", padding: "2px 6px", borderRadius: 4, fontWeight: 800, textTransform: "uppercase" }}>
                          {STATUS_LABELS[card.status] ?? card.status}
                        </span>
                      </div>
                    </div>
                    <div className="flash-card-front" style={{ fontSize: 16 }}>{card.front}</div>
                    <div className="flash-card-back" style={{ fontSize: 13, color: "var(--text-muted)" }}>{card.back}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(240, 230, 211, 0.05)" }}>
                      <div className="flash-card-source">из «{card.sourceBookTitle || card.source}»</div>
                      {card.intervalDays > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                          <Calendar size={10} /> {card.intervalDays} дн.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: TRAINING */}
      {activeTab === "train" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Mode switch (passive recognition vs active production) + the
              filters toggle share one row so they don't cost extra vertical
              space above the fold. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div className="mode-switch">
              <button className={`mode-switch-opt ${trainMode === "recognize" ? "active" : ""}`} onClick={() => { setTrainMode("recognize"); persistCardFilters({ trainMode: "recognize" }); }} type="button">Узнавание</button>
              <button className={`mode-switch-opt ${trainMode === "active" ? "active" : ""}`} onClick={() => { setTrainMode("active"); persistCardFilters({ trainMode: "active" }); }} type="button">Активно</button>
            </div>
            {trainMode === "recognize" && (
              <button
                className={`all-filter-toggle ${showTrainFilterPanel ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); setShowTrainFilterPanel((v) => !v); }}
                type="button"
              >
                <SlidersHorizontal size={15} /> Фильтры
                {activeTrainFilterCount > 0 && <span className="all-filter-count">{activeTrainFilterCount}</span>}
                <ChevronDown size={12} />
              </button>
            )}
          </div>

          {trainMode === "active" ? (
            <ProductiveTrainer
              cards={cards}
              targetLanguage={targetLanguage}
              onReviewed={(card) => onUpdateCard({ ...card, lastReviewedAt: new Date().toISOString() })}
            />
          ) : (
          <>
          {showTrainFilterPanel && (
            <div className="all-filter-panel" onClick={(e) => e.stopPropagation()}>
              <div className="filter-group">
                <div className="filter-group-label">Тип</div>
                <div className="filter-chips">
                  {(["all", "word", "phrase", "sentence"] as FilterType[]).map((t) => (
                    <button
                      key={t}
                      className={`filter-chip ${trainFilter === t ? "active" : ""}`}
                      onClick={() => { setTrainFilter(t); persistCardFilters({ trainFilter: t }); startTrainingSession(trainStatus, t, trainVariants); }}
                      type="button"
                    >
                      {t === "all" ? "Все типы" : TYPE_LABELS[t]}
                      {t !== "all" && (
                        <span style={{ marginLeft: 4, opacity: 0.7 }}>
                          {trainPool.filter((it) => it.card.type === t).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Статус</div>
                <div className="filter-chips">
                  {(["all", "new", "learning", "review", "relearning", "hard"] as TrainStatus[]).map((s) => {
                    const count = buildTrainQueue(s, trainFilter, trainVariants).length;
                    return (
                      <button
                        key={s}
                        className={`filter-chip ${trainStatus === s ? "active" : ""}`}
                        onClick={() => { setTrainStatus(s); persistCardFilters({ trainStatus: s }); startTrainingSession(s, trainFilter, trainVariants); }}
                        type="button"
                      >
                        {s === "all" ? "Все статусы" : TRAIN_STATUS_LABELS[s]}
                        {s !== "all" && <span style={{ marginLeft: 4, opacity: 0.7 }}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
                {trainStatus === "hard" && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    Карточки с частыми ошибками — включая не назначенные на сегодня
                  </div>
                )}
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Вариант тренировки (можно выбрать несколько)</div>
                <div className="filter-chips">
                  {(["forward", "reverse", "audio"] as TrainVariant[]).map((v) => (
                    <button
                      key={v}
                      className={`filter-chip ${trainVariants.includes(v) ? "active" : ""}`}
                      onClick={() => {
                        const next = trainVariants.includes(v) ? trainVariants.filter((x) => x !== v) : [...trainVariants, v];
                        if (next.length === 0) return;
                        setTrainVariants(next);
                        persistCardFilters({ trainVariants: next });
                        startTrainingSession(trainStatus, trainFilter, next);
                      }}
                      type="button"
                    >
                      {TRAIN_VARIANT_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>

              {activeTrainFilterCount > 0 && (
                <button
                  className="filter-reset-btn"
                  onClick={() => { setTrainFilter("all"); setTrainStatus("all"); setTrainVariants(DEFAULT_TRAIN_VARIANTS); persistCardFilters({ trainFilter: "all", trainStatus: "all", trainVariants: DEFAULT_TRAIN_VARIANTS }); startTrainingSession("all", "all", DEFAULT_TRAIN_VARIANTS); }}
                  type="button"
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}

          {trainQueue.length === 0 ? (
            dueCards.length === 0 && trainStatus !== "hard" ? (
              <div className="empty-state">
                <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
                <strong>Нечего повторять!</strong>
                <p>Нет карточек для тренировки. Добавьте новые слова во время чтения.</p>
              </div>
            ) : (
              <div className="empty-state">
                <AlertCircle size={40} />
                <strong>Нет карточек по выбранным фильтрам</strong>
                <p>{trainStatus === "hard" ? "Отлично — сложных карточек нет!" : "Попробуйте другой тип или статус."}</p>
              </div>
            )
          ) : currentTrainIndex >= trainQueue.length ? (
            <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
              <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
              <strong>Тренировка завершена!</strong>
              <p>Вы повторили все {trainQueue.length} карточек. Отличная работа!</p>
              <button className="secondary-btn" style={{ marginTop: 12 }} onClick={restartTraining} type="button">
                <RotateCcw size={14} /> Начать заново
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Progress */}
              <div style={{ width: "100%", maxWidth: 420, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                <span>Карточка {currentTrainIndex + 1} из {trainQueue.length}</span>
                <span style={{ color: "var(--accent)" }}>{Math.round((currentTrainIndex / trainQueue.length) * 100)}% пройдено</span>
              </div>

              {/* Flipper card — height adapts to content */}
              <div className="flipper-perspective" style={{ marginBottom: 16 }}>
                <div className={`flipper-card ${isFlipped ? "flipped" : ""}`}>
                  {/* Front */}
                  <div className="flipper-face flipper-face-front" onClick={() => setIsFlipped((f) => !f)}>
                    <div className="card-face-row">
                      <span className={`flash-card-type ${currentCard.type}`}>{TYPE_LABELS[currentCard.type]}{isAudio ? " · Аудио" : ""}</span>
                      <button
                        className="icon-btn"
                        style={{ width: 32, height: 32, marginLeft: "auto", marginRight: 4 }}
                        type="button"
                        aria-label="Обсудить с AI"
                        title="Обсудить с AI"
                        onClick={(e) => { e.stopPropagation(); void openDiscussForCard(currentCard); }}
                      >
                        <MessageCircle size={16} />
                      </button>
                      {/* TTS button — long press or right-click to change provider.
                          Hidden when the prompt is native-language text (speaking it
                          back is pointless) or audio mode (its own play button covers this). */}
                      {!isReversed && !isAudio && (
                        <div
                          className="card-tts-wrap"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={handleTtsPointerDown}
                          onPointerUp={handleTtsPointerUp}
                          onPointerLeave={() => { if (longPressRef.current) clearTimeout(longPressRef.current); }}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShowTtsMenu(true); }}
                        >
                          <SpeakButton text={promptText} lang={promptLang} size={15} />
                          {showTtsMenu && (
                            <div className="tts-menu" onClick={(e) => e.stopPropagation()}>
                              {TTS_PROVIDERS.map((p) => (
                                <div
                                  key={p.value}
                                  className={`tts-menu-item ${profile.ttsProvider === p.value ? "active" : ""}`}
                                  onClick={(e) => handleTtsProviderChange(p.value, e)}
                                >
                                  {p.label}
                                  {profile.ttsProvider === p.value ? " ✓" : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="card-text-area">
                      {isAudio ? (
                        <div className="audio-prompt">
                          <button
                            type="button"
                            className="audio-play-btn"
                            aria-label="Прослушать"
                            onClick={(e) => { e.stopPropagation(); void speak(currentCard.front, targetLanguage); }}
                          >
                            <Volume2 size={26} />
                          </button>
                          <span className="audio-prompt-lbl">Нажмите, чтобы услышать</span>
                        </div>
                      ) : isReversed ? (
                        <div style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}>{promptText}</div>
                      ) : (
                        <TokenizedText
                          text={promptText}
                          style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                        />
                      )}
                    </div>

                    <div className="card-footer-row">
                      <span>{currentCard.sourceBookTitle || currentCard.source}</span>
                      {currentProgress?.status === "new" && (
                        <span style={{ color: "var(--accent)", fontWeight: 800, flexShrink: 0, maxWidth: "none" }}>НОВАЯ</span>
                      )}
                    </div>
                  </div>

                  {/* Back */}
                  <div className="flipper-face flipper-face-back" onClick={() => setIsFlipped((f) => !f)}>
                    <div className="card-face-row">
                      <span className="flash-card-type sentence" style={{ background: "rgba(122, 171, 106, 0.15)", color: "var(--green)" }}>{isAudio ? "Текст" : isReversed ? "Ответ" : "Перевод"}</span>
                      {(isReversed || isAudio) && (
                        <div className="card-tts-wrap" style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                          <SpeakButton text={currentCard.front} lang={targetLanguage} size={15} />
                        </div>
                      )}
                    </div>
                    <div className="card-text-area">
                      {isAudio ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <TokenizedText
                            text={currentCard.front}
                            style={{ fontSize: cardFontSize(currentCard.front), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3, textAlign: "center" }}
                          />
                          <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>{currentCard.back}</div>
                        </div>
                      ) : isReversed ? (
                        <TokenizedText
                          text={answerText}
                          style={{ fontSize: cardFontSize(answerText), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3 }}
                        />
                      ) : (
                        <div style={{ fontSize: cardFontSize(answerText), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3 }}>
                          {answerText}
                        </div>
                      )}
                    </div>
                    <div className="card-footer-row">
                      <span>Повторений: {currentProgress?.repetitions ?? 0}</span>
                      <span style={{ maxWidth: "none" }}>Коэф: {(currentProgress?.easeFactor ?? 2.5).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Grade buttons — always available */}
              <div className="srs-grade-row">
                <button className="grade-btn grade-btn-1" onClick={() => handleGrade(1)} type="button">
                  <span className="grade-score">1</span>
                  <span className="grade-lbl">Забыл</span>
                </button>
                <button className="grade-btn grade-btn-2" onClick={() => handleGrade(2)} type="button">
                  <span className="grade-score">2</span>
                  <span className="grade-lbl">Трудно</span>
                </button>
                <button className="grade-btn grade-btn-3" onClick={() => handleGrade(3)} type="button">
                  <span className="grade-score">3</span>
                  <span className="grade-lbl">Хорошо</span>
                </button>
                <button className="grade-btn grade-btn-4" onClick={() => handleGrade(4)} type="button">
                  <span className="grade-score">4</span>
                  <span className="grade-lbl">Легко</span>
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* TAB: ALL CARDS */}
      {activeTab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div className="all-toolbar">
            <div className="all-search-bar">
              <Search size={18} className="text-muted" />
              <input
                className="all-search-input"
                placeholder="Поиск по карточкам..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(50); }}
                type="text"
              />
              {searchQuery && (
                <button style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontWeight: "bold" }} onClick={() => setSearchQuery("")} type="button">✕</button>
              )}
            </div>
            <button
              className={`all-filter-toggle ${showFilterPanel ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setShowFilterPanel((v) => !v); }}
              type="button"
            >
              <SlidersHorizontal size={15} /> Фильтры
              {activeFilterCount > 0 && <span className="all-filter-count">{activeFilterCount}</span>}
              <ChevronDown size={12} />
            </button>
          </div>

          {showFilterPanel && (
            <div className="all-filter-panel" onClick={(e) => e.stopPropagation()}>
              <div className="filter-group">
                <div className="filter-group-label">Статус</div>
                <div className="filter-chips">
                  {(["all", "new", "learning", "review", "relearning"] as FilterStatus[]).map((s) => (
                    <button key={s} className={`filter-chip ${filterStatus === s ? "active" : ""}`} onClick={() => { setFilterStatus(s); persistCardFilters({ filterStatus: s }); setVisibleCount(50); }} type="button">
                      {s === "all" ? "Все" : STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Тип</div>
                <div className="filter-chips">
                  {(["all", "word", "phrase", "sentence"] as FilterType[]).map((t) => (
                    <button key={t} className={`filter-chip ${filterType === t ? "active" : ""}`} onClick={() => { setFilterType(t); persistCardFilters({ filterType: t }); setVisibleCount(50); }} type="button">
                      {t === "all" ? "Все типы" : TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {allBooks.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Книга</div>
                  <select className="book-select" value={filterBook} onChange={(e) => { setFilterBook(e.target.value); persistCardFilters({ filterBook: e.target.value }); setVisibleCount(50); }}>
                    <option value="all">Все книги</option>
                    {allBooks.map((b) => <option key={b} value={b}>{b.length > 20 ? b.slice(0, 20) + "…" : b}</option>)}
                  </select>
                </div>
              )}

              <div className="filter-group">
                <div className="filter-group-label">Сортировка</div>
                <div className="filter-chips">
                  {([["added", "По дате добавления"], ["due", "По дате повторения"], ["ease", "По лёгкости"]] as [SortOrder, string][]).map(([val, lbl]) => (
                    <button key={val} className={`filter-chip ${sortOrder === val ? "active" : ""}`} onClick={() => { setSortOrder(val); persistCardFilters({ sortOrder: val }); }} type="button">{lbl}</button>
                  ))}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button className="filter-reset-btn" onClick={() => { setFilterStatus("all"); setFilterType("all"); setFilterBook("all"); persistCardFilters({ filterStatus: "all", filterType: "all", filterBook: "all" }); setVisibleCount(50); }} type="button">
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 8 }}>
            {filteredAllCards.length} карточек
          </div>

          {filteredAllCards.length === 0 ? (
            <div className="empty-state">
              <AlertCircle size={40} />
              <strong>Карточки не найдены</strong>
              <p>{searchQuery ? "Попробуйте изменить запрос." : "Словарь пуст. Добавьте карточки во время чтения."}</p>
            </div>
          ) : (
            <div className="card-list">
              {visibleCards.map((card) => (
                <div key={card.id} className="flash-card" style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span className={`flash-card-type ${card.type}`}>{TYPE_LABELS[card.type]}</span>
                      <span style={{ fontSize: 10, background: `${STATUS_COLORS[card.status] ?? "var(--accent)"}18`, color: STATUS_COLORS[card.status] ?? "var(--accent)", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
                        {STATUS_LABELS[card.status] ?? card.status}
                        {card.intervalDays > 0 ? ` · ${card.intervalDays}дн` : ""}
                      </span>
                    </div>
                    <div className="flash-card-front" style={{ fontSize: 15 }}>{card.front}</div>
                    <div className="flash-card-back" style={{ fontSize: 13, color: "var(--text-muted)" }}>{card.back}</div>
                    <div className="flash-card-source">из «{card.sourceBookTitle || card.source}»</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <button
                      className="card-row-delete-btn"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => void openDiscussForCard(card)}
                      type="button"
                      aria-label="Обсудить с AI"
                      title="Обсудить с AI"
                    >
                      <MessageCircle size={16} />
                    </button>
                    <button
                      className="card-row-delete-btn"
                      onClick={() => { if (confirm("Удалить карточку?")) onDeleteCard(card.id); }}
                      type="button"
                      aria-label="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {visibleCount < filteredAllCards.length && (
                <div ref={sentinelRef} style={{ height: 1 }} />
              )}
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

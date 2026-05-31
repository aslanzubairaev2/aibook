"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Search, Trash2, Flame, Calendar, CheckCircle2, RotateCcw, AlertCircle, Play, Layers, ChevronDown } from "lucide-react";
import type { AiAnalysis, Flashcard, TtsProvider } from "@/lib/types";
import { calculateSM2 } from "@/lib/srs/sm2";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis, getLocalProfile, saveLocalProfile, getSrsSession, saveSrsSession, clearSrsSession } from "@/lib/db/local";
import { WordModal } from "@/components/word-modal/WordModal";

type Props = {
  cards: Flashcard[];
  onBack: () => void;
  onUpdateCard: (card: Flashcard) => void;
  onDeleteCard: (id: string) => void;
};

type FilterStatus = "all" | "new" | "learning" | "review" | "relearning";
type FilterType = "all" | "word" | "phrase" | "sentence";
type SortOrder = "added" | "due" | "ease";

const TYPE_LABELS = { word: "Слово", phrase: "Фраза", sentence: "Предложение" } as const;

const TTS_PROVIDERS: { value: TtsProvider; label: string }[] = [
  { value: "local", label: "Браузер" },
  { value: "gemini", label: "Gemini TTS" },
  { value: "deepgram", label: "Deepgram" },
];

export function CardsView({ cards, onBack, onUpdateCard, onDeleteCard }: Props) {
  const [profile, setProfile] = useState(getLocalProfile);
  const targetLanguage = profile.targetLanguage;
  const nativeLanguage = profile.nativeLanguage;

  const [activeTab, setActiveTab] = useState<"today" | "train" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterBook, setFilterBook] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("added");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showTtsMenu, setShowTtsMenu] = useState(false);

  // Training state
  const [currentTrainIndex, setCurrentTrainIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);

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
      setReviewedIds(saved.reviewedIds);
      setCurrentTrainIndex(Math.min(saved.currentIndex, dueCards.length));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueCards.length]);

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
  useEffect(() => {
    const handler = () => { setShowSortMenu(false); setShowTtsMenu(false); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // --- Training ---
  const handleGrade = (score: 1 | 2 | 3 | 4) => {
    if (dueCards.length === 0 || currentTrainIndex >= dueCards.length) return;
    const card = dueCards[currentTrainIndex];
    const srsUpdate = calculateSM2(score, card.repetitions, card.lapses, card.intervalDays, card.easeFactor);
    const updatedCard: Flashcard = { ...card, ...srsUpdate, lastReviewedAt: new Date().toISOString() };
    onUpdateCard(updatedCard);

    const nextReviewedIds = [...reviewedIds, card.id];
    const nextIndex = currentTrainIndex + 1;
    setReviewedIds(nextReviewedIds);
    saveSrsSession(nextReviewedIds, nextIndex);

    setIsFlipped(false);
    setTimeout(() => setCurrentTrainIndex(nextIndex), 250);
  };

  const restartTraining = () => {
    setCurrentTrainIndex(0);
    setReviewedIds([]);
    setIsFlipped(false);
    clearSrsSession();
  };

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

  // --- Word tap → WordModal ---
  const handleWordTap = useCallback(async (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const currentCard = dueCards[currentTrainIndex];

  return (
    <section className="screen" onClick={() => { setShowSortMenu(false); setShowTtsMenu(false); }}>
      <style>{`
        .srs-tabs-container { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 20px; gap: 12px; }
        .srs-tab { padding: 10px 4px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; font-weight: 700; font-size: 14px; color: var(--text-muted); transition: all 0.2s; cursor: pointer; }
        .srs-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .srs-tab-badge { display: inline-flex; align-items: center; justify-content: center; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 11px; padding: 2px 6px; border-radius: 6px; margin-left: 6px; font-weight: 800; }
        .srs-tab-badge.empty { background: rgba(240, 230, 211, 0.08); color: var(--text-muted); }
        .srs-stats-banner { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 20px; }
        .srs-stat-card { padding: 12px 8px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .srs-stat-val { font-size: 20px; font-weight: 900; line-height: 1.1; display: flex; align-items: center; gap: 4px; }
        .srs-stat-lbl { font-size: 10px; color: var(--text-muted); font-weight: 700; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
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
        .all-search-bar { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--bg-card); border-radius: var(--radius-sm); padding: 0 12px; height: 40px; margin-bottom: 12px; }
        .all-search-input { flex: 1; background: transparent; border: none; color: var(--text-primary); outline: none; font-size: 14px; }
        .card-row-delete-btn { color: var(--text-muted); background: transparent; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
        .card-row-delete-btn:hover { color: #e08888; background: rgba(224, 136, 136, 0.08); }
        .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .filter-chip { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.2s; white-space: nowrap; }
        .filter-chip.active { background: rgba(212, 168, 71, 0.15); border-color: var(--accent); color: var(--accent); }
        .sort-menu-wrap { position: relative; }
        .sort-menu { position: absolute; top: calc(100% + 4px); right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 4px; z-index: 100; min-width: 170px; box-shadow: var(--shadow-sm); }
        .sort-menu-item { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-primary); transition: background 0.15s; }
        .sort-menu-item:hover { background: var(--bg-elevated); }
        .sort-menu-item.active { color: var(--accent); }
        .book-select { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; color: var(--text-muted); font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; outline: none; max-width: 130px; }
        .book-select:focus { border-color: var(--accent); color: var(--accent); }
      `}</style>

      {/* Word Modal */}
      <WordModal
        analysis={wordModal.analysis}
        isOpen={wordModal.open}
        isLoading={wordModal.loading}
        lang={targetLanguage}
        selectedWord={wordModal.word}
        onClose={() => setWordModal((s) => ({ ...s, open: false }))}
        onAddCard={() => {}}
      />

      {/* Screen Header */}
      <header className="screen-header">
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
        <div className="srs-stat-card">
          <div className="srs-stat-val" style={{ color: "var(--accent)" }}>{dueCards.length}</div>
          <div className="srs-stat-lbl">Осталось сегодня</div>
        </div>
        <div className="srs-stat-card">
          <div className="srs-stat-val" style={{ color: streak > 0 ? "var(--accent)" : "var(--text-muted)" }}>
            <Flame size={18} fill={streak > 0 ? "var(--accent)" : "none"} style={{ marginRight: 2 }} />
            {streak}
          </div>
          <div className="srs-stat-lbl">Серия дней</div>
        </div>
        <div className="srs-stat-card">
          <div className="srs-stat-val" style={{ color: "var(--green)" }}>{learnedCount}</div>
          <div className="srs-stat-lbl">Изучено слов</div>
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
            if (currentTrainIndex >= dueCards.length) restartTraining();
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
                      <span style={{ fontSize: 10, background: `${STATUS_COLORS[card.status] ?? "var(--accent)"}18`, color: STATUS_COLORS[card.status] ?? "var(--accent)", padding: "2px 6px", borderRadius: 4, fontWeight: 800, textTransform: "uppercase" }}>
                        {STATUS_LABELS[card.status] ?? card.status}
                      </span>
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
          {dueCards.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
              <strong>Нечего повторять!</strong>
              <p>Нет карточек для тренировки. Добавьте новые слова во время чтения.</p>
            </div>
          ) : currentTrainIndex >= dueCards.length ? (
            <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
              <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
              <strong>Тренировка завершена!</strong>
              <p>Вы повторили все {dueCards.length} карточек. Отличная работа!</p>
              <button className="secondary-btn" style={{ marginTop: 12 }} onClick={restartTraining} type="button">
                <RotateCcw size={14} /> Начать заново
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Progress */}
              <div style={{ width: "100%", maxWidth: 420, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                <span>Карточка {currentTrainIndex + 1} из {dueCards.length}</span>
                <span style={{ color: "var(--accent)" }}>{Math.round((currentTrainIndex / dueCards.length) * 100)}% пройдено</span>
              </div>

              {/* Flipper card — height adapts to content */}
              <div className="flipper-perspective" style={{ marginBottom: 16 }}>
                <div className={`flipper-card ${isFlipped ? "flipped" : ""}`}>
                  {/* Front */}
                  <div className="flipper-face flipper-face-front" onClick={() => setIsFlipped((f) => !f)}>
                    <div className="card-face-row">
                      <span className={`flash-card-type ${currentCard.type}`}>{TYPE_LABELS[currentCard.type]}</span>
                      {/* TTS button — long press or right-click to change provider */}
                      <div
                        className="card-tts-wrap"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={handleTtsPointerDown}
                        onPointerUp={handleTtsPointerUp}
                        onPointerLeave={() => { if (longPressRef.current) clearTimeout(longPressRef.current); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShowTtsMenu(true); }}
                      >
                        <SpeakButton text={currentCard.front} lang={targetLanguage} size={15} />
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
                    </div>

                    <div className="card-text-area">
                      <TokenizedText
                        text={currentCard.front}
                        style={{ fontSize: cardFontSize(currentCard.front), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                      />
                    </div>

                    <div className="card-footer-row">
                      <span>{currentCard.sourceBookTitle || currentCard.source}</span>
                      {currentCard.status === "new" && (
                        <span style={{ color: "var(--accent)", fontWeight: 800, flexShrink: 0, maxWidth: "none" }}>НОВАЯ</span>
                      )}
                    </div>
                  </div>

                  {/* Back */}
                  <div className="flipper-face flipper-face-back" onClick={() => setIsFlipped((f) => !f)}>
                    <div className="card-face-row">
                      <span className="flash-card-type sentence" style={{ background: "rgba(122, 171, 106, 0.15)", color: "var(--green)" }}>Перевод</span>
                    </div>
                    <div className="card-text-area">
                      <div style={{ fontSize: cardFontSize(currentCard.back), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3 }}>
                        {currentCard.back}
                      </div>
                    </div>
                    <div className="card-footer-row">
                      <span>Повторений: {currentCard.repetitions}</span>
                      <span style={{ maxWidth: "none" }}>Коэф: {currentCard.easeFactor.toFixed(2)}</span>
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
        </div>
      )}

      {/* TAB: ALL CARDS */}
      {activeTab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
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

          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div className="filter-chips">
              {(["all", "new", "learning", "review", "relearning"] as FilterStatus[]).map((s) => (
                <button key={s} className={`filter-chip ${filterStatus === s ? "active" : ""}`} onClick={() => { setFilterStatus(s); setVisibleCount(50); }} type="button">
                  {s === "all" ? "Все" : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="sort-menu-wrap">
              <button className="filter-chip" onClick={(e) => { e.stopPropagation(); setShowSortMenu((v) => !v); }} type="button" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                Сортировка <ChevronDown size={11} />
              </button>
              {showSortMenu && (
                <div className="sort-menu" onClick={(e) => e.stopPropagation()}>
                  {([["added", "По дате добавления"], ["due", "По дате повторения"], ["ease", "По лёгкости"]] as [SortOrder, string][]).map(([val, lbl]) => (
                    <div key={val} className={`sort-menu-item ${sortOrder === val ? "active" : ""}`} onClick={() => { setSortOrder(val); setShowSortMenu(false); }}>{lbl}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div className="filter-chips">
              {(["all", "word", "phrase", "sentence"] as FilterType[]).map((t) => (
                <button key={t} className={`filter-chip ${filterType === t ? "active" : ""}`} onClick={() => { setFilterType(t); setVisibleCount(50); }} type="button">
                  {t === "all" ? "Все типы" : TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {allBooks.length > 1 && (
              <select className="book-select" value={filterBook} onChange={(e) => { setFilterBook(e.target.value); setVisibleCount(50); }}>
                <option value="all">Все книги</option>
                {allBooks.map((b) => <option key={b} value={b}>{b.length > 20 ? b.slice(0, 20) + "…" : b}</option>)}
              </select>
            )}
          </div>

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
                  <button
                    className="card-row-delete-btn"
                    onClick={() => { if (confirm("Удалить карточку?")) onDeleteCard(card.id); }}
                    type="button"
                    aria-label="Удалить"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {visibleCount < filteredAllCards.length && (
                <div ref={sentinelRef} style={{ height: 1 }} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

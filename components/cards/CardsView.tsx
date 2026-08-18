"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { ArrowLeft, Search, Trash2, Flame, Calendar, CheckCircle2, RotateCcw, AlertCircle, Play, Layers, ChevronDown, ChevronLeft, ChevronRight, MessageCircle, SlidersHorizontal, Volume2, FileText, Loader2, Eye, X, BarChart3, Maximize2, Minimize2, Keyboard, EyeOff } from "lucide-react";
import type { AiAnalysis, CardFilters, CardSkillState, DiscussMessage, Flashcard, ReverseWordAnalysis, TrainVariant, TtsProvider } from "@/lib/types";
import { calculateSM2, createDefaultSrsFields } from "@/lib/srs/sm2";
import {
  ALL_TRAIN_VARIANTS,
  buildTrainQueue,
  computeDeckStats,
  countTrainCandidates,
  deckInsight,
  listCardSources,
  type CardSource,
  describePackTraining,
  normalizePackTraining,
  CARD_STATUSES,
  filterCardsByTrainingSource,
  findDuplicateCard,
  getReviewHistoryPosition,
  getVariantProgress,
  isVariantDue,
  resolveCardFilters,
  shuffleTrainQueue,
  splitCardBack,
  DEFAULT_TRAIN_VARIANTS,
  type DeckStats,
  type ResolvedCardFilters,
  type TrainBatch,
  type TrainQueueItem,
  type TrainStatus,
  type VariantProgressMap,
} from "@/lib/cards";
import { isTypingTarget, trainerHotkey } from "@/lib/srs/trainerHotkeys";
import { TrainerKeysModal } from "@/components/cards/TrainerKeysModal";
import { SourcePickerModal } from "@/components/cards/SourcePickerModal";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { getTTSState, prefetchSpeechAhead, respeak, speak, stopTTS, subscribeTTS, toggleRepeat } from "@/lib/tts";
import { RespeakButton } from "@/components/ui/RespeakButton";
import { getAvailableTtsProviders, getTtsProviderLabel } from "@/lib/ttsProviders";
import { analyzeSelection } from "@/lib/ai/analyze";
import { makeAiCacheKey, makeDiscussCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalAiAnalysis, saveLocalAiAnalysis, getLocalProfile, saveLocalProfile, getSrsSession, saveSrsSession, clearSrsSession, getLocalDiscussHistory, saveLocalDiscussHistory, getCardSkillProgressMap, getCardVariantProgressMap, saveCardVariantProgress } from "@/lib/db/local";
import { sbInsertFlashcard, sbGetDiscussHistory, sbSaveDiscussHistory, sbUpsertCardVariantProgress, sbUpsertSettings, sbAuthHeaders } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { WordModal } from "@/components/word-modal/WordModal";
import { ReverseWordModal } from "@/components/word-modal/ReverseWordModal";
import { DiscussAiModal } from "@/components/discuss-ai/DiscussAiModal";
import { describeCardFamiliarity } from "@/lib/ai/wordProfile";
import { ProductiveTrainer } from "@/components/cards/ProductiveTrainer";
import { SkillBadges } from "@/components/cards/SkillBadges";

type Props = {
  cards: Flashcard[];
  /** Which tab to open on — "all" when arriving from «тренировать пачку» in the dictionary. */
  initialTab?: "today" | "train" | "all" | null;
  /**
   * A dictionary batch to train, handed over by «тренировать эту пачку».
   * Session-only: it narrows this visit and is never written over the saved
   * filters, so the learner's own training setup survives it.
   */
  trainBatch?: TrainBatch | null;
  /** Lets the owner drop its copy of the batch once the session leaves it. */
  onExitBatch?: () => void;
  onBack: () => void;
  onAddCard: (card: Flashcard) => void;
  onUpdateCard: (card: Flashcard) => void;
  onDeleteCard: (id: string) => void;
};

function normalizeFront(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

const POS_SHORT: Record<string, string> = {
  "существительное": "сущ.", "глагол": "гл.", "прилагательное": "прил.",
  "наречие": "нар.", "предлог": "предл.", "союз": "союз",
  "местоимение": "мест.", "числительное": "числ.", "выражение": "выраж.",
};
function shortPos(pos: string): string {
  return POS_SHORT[pos.trim().toLowerCase()] ?? "";
}

/**
 * For cards that predate the dictionary: German spelling gives away the two
 * cases worth marking. Anything less certain shows no chip at all rather than
 * a guess the learner would have to double-check.
 */
function guessPos(front: string): string {
  const text = front.trim();
  if (/^(der|die|das)\s+\S/i.test(text)) return "сущ.";
  if (/^[a-zäöüß]+(en|ern|eln)$/i.test(text)) return "гл.";
  return "";
}

type FilterStatus = "all" | "new" | "learning" | "review" | "relearning";
type FilterType = "all" | "word" | "phrase" | "sentence";
type SortOrder = "added" | "due" | "ease";

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

// The same three, short enough to sit in a row above the card. A pack is
// learned in this order — read it, then produce it, then take it by ear — and
// that order is the row's order.
const VARIANT_SHORT_LABELS: Record<TrainVariant, string> = {
  forward: "Читаю",
  reverse: "Говорю",
  audio: "Слышу",
};
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

/** The three states in which the player is on screen — same test AudioScrubber makes. */
function isPlayerShowing(status: string): boolean {
  return status === "playing" || status === "paused" || status === "loading";
}

function cardNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "карточек";
  if (mod10 === 1) return "карточка";
  if (mod10 >= 2 && mod10 <= 4) return "карточки";
  return "карточек";
}

function sourceNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "источников";
  if (mod10 === 1) return "источник";
  if (mod10 >= 2 && mod10 <= 4) return "источника";
  return "источников";
}

function endOfTodayMs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Offer only the voices that can actually speak the deck's language. */
function ttsProvidersFor(lang: string): { value: TtsProvider; label: string }[] {
  return getAvailableTtsProviders(lang).map((value) => ({
    value,
    label: value === "local" ? "Браузер" : getTtsProviderLabel(value),
  }));
}

// --- Tokenized card text ---
// Module-level and memoized on purpose. Declared inside the component body it
// was a brand-new component type on every render, so React threw away and
// rebuilt every tokenized span in the list — hundreds of them — each time any
// piece of state changed.
type TokenizedTextProps = {
  text: string;
  style?: React.CSSProperties;
  onWordTap: (word: string, e: React.MouseEvent) => void;
};

const TokenizedText = memo(function TokenizedText({ text, style, onWordTap }: TokenizedTextProps) {
  const tokens = useMemo(() => splitIntoTokens(text), [text]);
  return (
    <div style={style}>
      {tokens.map((tok, i) => {
        if (!normalizeToken(tok)) return <span key={i}>{tok}</span>;
        return (
          <span
            key={i}
            onClick={(e) => onWordTap(tok, e)}
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
});

/** The markers for one card: type, part of speech, level — in that order. */
function cardMarkers(card: Flashcard, facts: WordFacts | undefined): { text: string; kind: string }[] {
  const marks: { text: string; kind: string }[] = [
    { text: TYPE_LABELS[card.type], kind: card.type },
  ];
  const pos = card.type === "word" ? shortPos(facts?.pos ?? "") || guessPos(card.front) : "";
  if (pos) marks.push({ text: pos, kind: "pos" });
  const level = card.cefr || facts?.cefr || "";
  if (level) marks.push({ text: level, kind: "level" });
  return marks;
}

type WordFacts = { pos: string; cefr: string };

/** One shared empty object, so a row without skill progress stays memo-stable. */
const EMPTY_SKILL_STATE: CardSkillState = {};

const DueCardRow = memo(function DueCardRow({ card, skillState }: { card: Flashcard; skillState: CardSkillState }) {
  const color = STATUS_COLORS[card.status] ?? "var(--accent)";
  return (
    <div className="flash-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <span className={`flash-card-type ${card.type}`}>{TYPE_LABELS[card.type]}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SkillBadges cardId={card.id} state={skillState} />
          <span style={{ fontSize: 10, background: `${color}18`, color, padding: "2px 6px", borderRadius: 4, fontWeight: 800, textTransform: "uppercase" }}>
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
  );
});

type AllCardRowProps = {
  card: Flashcard;
  facts: WordFacts | undefined;
  targetLanguage: string;
  onWordTap: (word: string, e: React.MouseEvent) => void;
  onDiscuss: (card: Flashcard) => void;
  onDelete: (id: string) => void;
};

const AllCardRow = memo(function AllCardRow({ card, facts, targetLanguage, onWordTap, onDiscuss, onDelete }: AllCardRowProps) {
  const color = STATUS_COLORS[card.status] ?? "var(--accent)";
  return (
    <div className="flash-card" style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
          {cardMarkers(card, facts).map((m, i) => (
            <span key={i} className={`card-marker ${m.kind}${i === 0 ? " lead" : ""}`}>{m.text}</span>
          ))}
          <span style={{ fontSize: 10, background: `${color}18`, color, padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
            {STATUS_LABELS[card.status] ?? card.status}
            {card.intervalDays > 0 ? ` · ${card.intervalDays}дн` : ""}
          </span>
        </div>
        {/* Front is spoken and word-tappable, like text everywhere else in the app. */}
        <div className="flash-card-front" style={{ fontSize: 15, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <TokenizedText text={card.front} style={{ flex: 1 }} onWordTap={onWordTap} />
          <SpeakButton text={card.front} lang={targetLanguage} size={15} />
        </div>
        <TokenizedText text={card.back} style={{ fontSize: 13, color: "var(--text-muted)" }} onWordTap={onWordTap} />
        <div className="flash-card-source">из «{card.sourceBookTitle || card.source}»</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
        <button
          className="card-row-delete-btn"
          style={{ color: "var(--text-muted)" }}
          onClick={() => onDiscuss(card)}
          type="button"
          aria-label="Обсудить с AI"
          title="Обсудить с AI"
        >
          <MessageCircle size={16} />
        </button>
        <button
          className="card-row-delete-btn"
          onClick={() => { if (confirm("Удалить карточку?")) onDelete(card.id); }}
          type="button"
          aria-label="Удалить"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
});

const VARIANT_LABELS_LONG: Record<TrainVariant, string> = {
  forward: "Узнавание",
  reverse: "Воспроизведение",
  audio: "Аудирование",
};

const VARIANT_COLORS: Record<TrainVariant, string> = {
  forward: "var(--blue)",
  reverse: "var(--accent)",
  audio: "var(--green)",
};

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** A labelled progress row — the shape every block in the panel is built from. */
function StatBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="srs-bar-row">
      <span className="srs-bar-label">{label}</span>
      <span className="srs-bar-track"><i style={{ width: `${pct}%`, background: color }} /></span>
      <span className="srs-bar-value">{value}<small> / {total}</small></span>
    </div>
  );
}

/**
 * The detail behind the today line.
 *
 * Counters alone say what is true without saying what to do, so this is built
 * around comparisons a learner can act on: which of the three directions is
 * lagging, what today's remaining work is made of, and which day of the coming
 * week is going to hurt. Everything is counted per direction, the same way a
 * session is, so the numbers here and the trainer's own progress line describe
 * the same work.
 */
const StatsPanel = memo(function StatsPanel({ stats, onClick }: { stats: DeckStats; onClick: (e: React.MouseEvent) => void }) {
  const learnedPct = stats.totalVariants > 0 ? Math.round((stats.learnedVariants / stats.totalVariants) * 100) : 0;
  // Today's column carries done + remaining, so the scale has to account for
  // both or a finished day would overflow the chart.
  const forecastPeak = Math.max(1, ...stats.forecast.map((d) => d.count + d.done));
  const topSources = stats.sources.slice(0, 8);
  const insight = deckInsight(stats);
  const notStarted = stats.totalCards - stats.learnedCards;

  return (
    <div className="srs-stats-panel" onClick={onClick}>
      <section>
        <div className="srs-stats-head">
          <div className="srs-stats-section-label">Освоение трёх направлений</div>
          <span className="srs-stats-note">начато {stats.learnedVariants} из {stats.totalVariants} · {learnedPct}%</span>
        </div>
        {ALL_TRAIN_VARIANTS.map((variant) => (
          <StatBar
            key={variant}
            label={VARIANT_LABELS_LONG[variant]}
            value={stats.startedByVariant[variant]}
            total={stats.totalCards}
            color={VARIANT_COLORS[variant]}
          />
        ))}
      </section>

      <section>
        <div className="srs-stats-head">
          <div className="srs-stats-section-label">Осталось сегодня</div>
          <span className="srs-stats-note">{stats.dueCards} карточек · {stats.dueReps} повторений</span>
        </div>
        {stats.dueReps === 0 ? (
          <div className="srs-stats-empty">
            {stats.reviewedToday > 0
              ? `Всё повторено — сегодня сделано ${stats.reviewedToday}. Можно отдыхать или читать.`
              : "Всё повторено — можно отдыхать или читать."}
          </div>
        ) : (
          <>
            <div className="srs-stat-bar">
              {ALL_TRAIN_VARIANTS.map((variant) => (
                <i
                  key={variant}
                  style={{ width: `${(stats.dueByVariant[variant] / stats.dueReps) * 100}%`, background: VARIANT_COLORS[variant] }}
                />
              ))}
            </div>
            <div className="srs-stat-legend">
              {ALL_TRAIN_VARIANTS.map((variant) => (
                <span key={variant}>
                  <i style={{ background: VARIANT_COLORS[variant] }} />
                  {VARIANT_LABELS_LONG[variant]} — {stats.dueByVariant[variant]}
                </span>
              ))}
            </div>
            {/* Leftovers from earlier days are the usual reason today's number
                is bigger than yesterday's forecast promised. */}
            {stats.overdueReps > 0 && (
              <div className="srs-stats-empty">
                Из них {stats.overdueReps} с прошлых дней ({stats.overdueCards} карт.) — они уже в очереди на сегодня.
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <div className="srs-stats-head">
          <div className="srs-stats-section-label">Состояние колоды</div>
          <span className="srs-stats-note">показатели независимы и могут пересекаться</span>
        </div>
        <StatBar label="Трудные" value={stats.hardCards} total={stats.totalCards} color="#e08888" />
        <StatBar label="Не начаты" value={notStarted} total={stats.totalCards} color="var(--accent)" />
        <StatBar label="Зрелые" value={stats.matureCards} total={stats.totalCards} color="var(--green)" />
        <div className="srs-stats-legend-row">
          {CARD_STATUSES.map((status) => (
            <span key={status}>
              <i style={{ background: STATUS_COLORS[status] }} />
              {STATUS_LABELS[status]}: {stats.byStatus[status]}
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="srs-stats-head">
          <div className="srs-stats-section-label">Прогноз на неделю</div>
          <span className="srs-stats-note">назначенных повторений</span>
        </div>
        <div className="srs-forecast">
          {stats.forecast.map((day) => {
            const total = day.count + day.done;
            const isToday = day.dayOffset === 0;
            return (
              <div className={`srs-forecast-col${isToday ? " today" : ""}`} key={day.dayOffset}>
                <span className="srs-forecast-val">{total || ""}</span>
                {/* Today is drawn in two parts — what is done under what is
                    left — so a cleared day reads as a full green column
                    instead of the blank the chart used to show. */}
                <div className="srs-forecast-track">
                  <div className="srs-forecast-stack" style={{ height: `${Math.max(3, (total / forecastPeak) * 100)}%` }}>
                    {day.count > 0 && (
                      <div className="srs-forecast-bar" style={{ flexGrow: day.count }} />
                    )}
                    {day.done > 0 && (
                      <div className="srs-forecast-bar done" style={{ flexGrow: day.done }} />
                    )}
                    {total === 0 && <div className="srs-forecast-bar empty" style={{ flexGrow: 1 }} />}
                  </div>
                </div>
                <span className="srs-forecast-lbl">{isToday ? "сегодня" : WEEKDAYS[day.date.getDay()]}</span>
                <span className="srs-forecast-date">{day.date.getDate()}</span>
              </div>
            );
          })}
        </div>
        <div className="srs-forecast-key">
          <span><i className="done" />сделано сегодня</span>
          <span><i />назначено</span>
        </div>
      </section>

      {topSources.length > 0 && (
        <section>
          <div className="srs-stats-head">
            <div className="srs-stats-section-label">По источникам</div>
            <span className="srs-stats-note">книги и пачки из словаря</span>
          </div>
          {topSources.map((source) => (
            <div className="srs-source-row" key={source.key}>
              <span className="srs-source-title" title={source.title}>{source.title}</span>
              <span className="srs-source-meta">{source.learned}/{source.cards}</span>
              <span className="srs-source-due">{source.due > 0 ? `+${source.due}` : "—"}</span>
            </div>
          ))}
          {stats.sources.length > topSources.length && (
            <div className="srs-stats-empty">и ещё {stats.sources.length - topSources.length} источник(ов)</div>
          )}
        </section>
      )}

      {insight && <div className="srs-stats-insight">{insight}</div>}
    </div>
  );
});

export function CardsView({ cards, initialTab, trainBatch, onExitBatch, onBack, onAddCard, onUpdateCard, onDeleteCard }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(getLocalProfile);
  const targetLanguage = profile.targetLanguage;
  const nativeLanguage = profile.nativeLanguage;

  const savedFilters = profile.cardFilters;

  // The batch narrows this visit only. Held here so leaving it is a local
  // change of mind rather than a round trip through the owner.
  const [batch, setBatch] = useState<TrainBatch | null>(trainBatch ?? null);
  // What this pack's own setup does, and why — shown in the banner so a
  // session that ignores the learner's usual filters explains itself.
  const batchTrainingSummary = describePackTraining(batch?.training);
  const batchTrainingNote = normalizePackTraining(batch?.training)?.note ?? "";
  const [initialFilters] = useState<ResolvedCardFilters>(() => resolveCardFilters(savedFilters, trainBatch ?? null));

  const [activeTab, setActiveTab] = useState<"today" | "train" | "all">(initialTab ?? "today");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(initialFilters.filterStatus);
  const [filterType, setFilterType] = useState<FilterType>(initialFilters.filterType);
  const [filterBook, setFilterBook] = useState<string>(initialFilters.filterBook);
  const [filterLevel, setFilterLevel] = useState<string>(initialFilters.filterLevel);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialFilters.sortOrder);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showTrainFilterPanel, setShowTrainFilterPanel] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showTtsMenu, setShowTtsMenu] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Whether the audio player is on screen. While it is, two of the keypad's
  // grades drive it instead of the card — see trainerHotkeys.
  // `subscribeTTS` calls the listener once on subscribe, so the state is in
  // step from the first frame without a second read.
  const [playerOpen, setPlayerOpen] = useState(() => isPlayerShowing(getTTSState().status));
  useEffect(() => subscribeTTS((state) => setPlayerOpen(isPlayerShowing(state.status))), []);

  // Training state
  const [currentTrainIndex, setCurrentTrainIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const arrivedForBatch = Boolean(trainBatch);
  const [trainFilter, setTrainFilter] = useState<FilterType>(initialFilters.trainFilter);
  const [trainStatus, setTrainStatus] = useState<TrainStatus>(initialFilters.trainStatus);
  // Narrows a training session to one source — a book, or a dictionary batch
  // («тренировать именно эти слова» from the dictionary lands here).
  const [trainBook, setTrainBook] = useState<string>(initialFilters.trainBook);
  const [trainSourceId, setTrainSourceId] = useState<string | null>(initialFilters.trainSourceId);
  // Sources this learner has told the trainer to leave alone — the book they
  // have finished, the pack they are saving for next week. The opposite end of
  // the same question as trainBook above: one names what to train, this names
  // what to train around.
  const [trainExcluded, setTrainExcluded] = useState<string[]>(initialFilters.trainExcluded);
  const [trainVariants, setTrainVariants] = useState<TrainVariant[]>(initialFilters.trainVariants);
  const [trainMode, setTrainMode] = useState<"recognize" | "active">(initialFilters.trainMode);
  // Zen: the trainer with everything around it taken away — no header, no
  // counters, no tabs, no filters. Grading a card is one decision repeated a
  // hundred times, and on a phone the page around the card was tall enough to
  // push the grade buttons under the fold, so every single one of those
  // decisions cost a scroll down and a scroll back up.
  const [zenMode, setZenMode] = useState(initialFilters.zenMode);
  // Snapshot of the cards being trained this session — built once per session
  // start/filter change rather than re-derived from the (mutating) `cards`
  // prop on every render, so grading a card can't shrink the queue out from
  // under `currentTrainIndex` mid-session.
  const [trainQueue, setTrainQueue] = useState<TrainQueueItem[]>([]);
  // Session-only snapshots of cards that have already been graded. Browsing
  // this list never touches the live queue or any SRS state.
  const [reviewHistory, setReviewHistory] = useState<TrainQueueItem[]>([]);
  const [viewingHistoryIndex, setViewingHistoryIndex] = useState<number | null>(null);
  // This session was started as a drill: everything in scope, whether or not
  // the schedule says it is due. It is how a pack met for the first time gets
  // gone through again and again until the words start to stick — and it is
  // remembered for the session, so «ещё раз» at the end of it means the same
  // thing it meant at the start.
  const [drilling, setDrilling] = useState(false);

  // Per-variant SRS progress, read from storage once and replaced (never
  // mutated) after a grade, so every memo below can key on its identity
  // instead of re-reading storage per card.
  const [variantProgress, setVariantProgress] = useState<VariantProgressMap>(getCardVariantProgressMap);
  const skillProgress = useMemo(() => getCardSkillProgressMap(), [cards]);

  // The end of "today" only has to move when the day does.
  const [todayEndTime, setTodayEndTime] = useState(endOfTodayMs);
  useEffect(() => {
    const id = setInterval(() => {
      setTodayEndTime((prev) => {
        const next = endOfTodayMs();
        return next === prev ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Discuss-with-AI state (chat about a specific card)
  const [discuss, setDiscuss] = useState<{
    open: boolean;
    card: Flashcard | null;
    cacheKey: string;
    messages: DiscussMessage[];
    historyLoading: boolean;
  }>({ open: false, card: null, cacheKey: "", messages: [], historyLoading: false });

  // The card's own schedule is what tells the tutor whether this word needs a
  // memory hook or nothing but nuance.
  const discussWordProfile = useMemo(() => describeCardFamiliarity(discuss.card), [discuss.card]);

  // Word modal state
  const [wordModal, setWordModal] = useState<{
    open: boolean;
    word: string;
    analysis: AiAnalysis | null;
    loading: boolean;
  }>({ open: false, word: "", analysis: null, loading: false });

  // The other direction's lookup. A reverse card shows the learner's own
  // language, so a word tapped there is not a word to be explained — it is a
  // word they cannot yet say, and the answer is the target-language form.
  const [reverseWord, setReverseWord] = useState<{
    open: boolean;
    word: string;
    analysis: ReverseWordAnalysis | null;
    loading: boolean;
  }>({ open: false, word: "", analysis: null, loading: false });

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination for "All Cards"
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [showStats, setShowStats] = useState(false);

  // --- Stats ---
  // One traversal of the deck, reused by the banner, the badges and the panel.
  const stats = useMemo(
    () => computeDeckStats(cards, variantProgress, new Date(todayEndTime)),
    [cards, variantProgress, todayEndTime],
  );

  // A card belongs on "today" when any of its three directions is due — the
  // same rule the statistics use, so the banner, the tab badge and this list
  // can never disagree the way they used to.
  const dueCards = useMemo(
    () => cards.filter((card) =>
      ALL_TRAIN_VARIANTS.some((v) => isVariantDue(getVariantProgress(card, v, variantProgress), todayEndTime)),
    ),
    [cards, variantProgress, todayEndTime],
  );

  // Arriving straight on the training tab (from the dictionary's «тренировать»)
  // never went through the tab button, which is what used to build the queue —
  // so the session starts here instead. Nothing is persisted: the batch's own
  // "all types, all statuses, every direction" is how this one visit runs, not
  // a new preference.
  const batchSessionStartedRef = useRef(false);
  useEffect(() => {
    if (!arrivedForBatch || batchSessionStartedRef.current) return;
    batchSessionStartedRef.current = true;
    startTrainingSession(
      initialFilters.trainStatus,
      initialFilters.trainFilter,
      initialFilters.trainVariants,
      initialFilters.trainBook,
      initialFilters.trainSourceId,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedForBatch]);

  // --- Restore SRS session when dueCards become available ---
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    // A batch session was just started deliberately; restoring the previous
    // one over it would drop the learner back into unrelated cards.
    if (arrivedForBatch) return;
    if (dueCards.length === 0) return;
    const saved = getSrsSession();
    if (saved && saved.reviewedIds.length > 0) {
      sessionRestoredRef.current = true;
      const queue = makeTrainQueue(trainStatus, trainFilter, trainVariants);
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

  // --- Fetch the audio cards still ahead, before they are reached ---
  //
  // An audio card is nothing but its recording: it appears and immediately
  // plays, so its fetch cannot begin until the learner is already looking at a
  // blank prompt waiting for sound. Asking for the ones further down the queue
  // while this card is being answered means each arrives already fetched.
  useEffect(() => {
    const upcoming = trainQueue
      .slice(currentTrainIndex + 1)
      .filter((item) => item.variant === "audio")
      .map((item) => item.card.front);
    prefetchSpeechAhead(upcoming, targetLanguage);
  }, [trainQueue, currentTrainIndex, targetLanguage]);

  // Switching tabs starts its list from the top again.
  useEffect(() => {
    setVisibleCount(50);
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
  // Each selected variant (forward/reverse/audio) carries its own independent
  // schedule (see getVariantProgress), so a card produces one queue item per
  // due variant rather than a single coin-flip.
  const makeTrainQueue = useCallback(
    (
      status: TrainStatus,
      filter: FilterType,
      variants: TrainVariant[],
      book: string = trainBook,
      sourceId: string | null = trainSourceId,
      ignoreSchedule = false,
      excluded: string[] = trainExcluded,
    ): TrainQueueItem[] =>
      // Shuffled so multi-variant sessions interleave instead of running all of
      // one variant before the next.
      shuffleTrainQueue(
        buildTrainQueue(cards, { status, type: filter, variants, book, sourceId, excluded, ignoreSchedule }, variantProgress, todayEndTime),
      ),
    [cards, variantProgress, todayEndTime, trainBook, trainSourceId, trainExcluded],
  );

  // Live counts for the filter chips, computed in a single pass. Each chip used
  // to build its own full queue on every render, which is what made opening the
  // filter panel — or changing anything at all — take tens of seconds.
  const trainCounts = useMemo(
    () => countTrainCandidates(
      cards,
      { status: trainStatus, type: trainFilter, variants: trainVariants, book: trainBook, sourceId: trainSourceId, excluded: trainExcluded },
      variantProgress,
      todayEndTime,
    ),
    [cards, trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, trainExcluded, variantProgress, todayEndTime],
  );

  // The productive trainer keeps its own schedule but must obey the same
  // narrowing: "train this batch" means this batch in either mode.
  const trainCards = useMemo(
    () => filterCardsByTrainingSource(cards, trainBook, trainSourceId, trainExcluded),
    [cards, trainBook, trainSourceId, trainExcluded],
  );

  // Every source the deck draws from, with its size — the list the exclusion
  // chips are built from, and what makes «исключить» a decision rather than a
  // guess about how much it would remove.
  const cardSources = useMemo(() => listCardSources(cards), [cards]);

  // What «пройти заново» would actually serve. Shown on the empty state so the
  // offer is a number rather than a promise.
  const drillCandidates = useMemo(
    () => countTrainCandidates(
      cards,
      { status: trainStatus, type: trainFilter, variants: trainVariants, book: trainBook, sourceId: trainSourceId, excluded: trainExcluded, ignoreSchedule: true },
      variantProgress,
      todayEndTime,
    ).byType.all,
    [cards, trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, trainExcluded, variantProgress, todayEndTime],
  );

  function startTrainingSession(
    status: TrainStatus,
    filter: FilterType,
    variants: TrainVariant[],
    book: string = trainBook,
    sourceId: string | null = trainSourceId,
    ignoreSchedule = false,
    excluded: string[] = trainExcluded,
  ) {
    setTrainQueue(makeTrainQueue(status, filter, variants, book, sourceId, ignoreSchedule, excluded));
    setDrilling(ignoreSchedule);
    setCurrentTrainIndex(0);
    setReviewedIds([]);
    setIsFlipped(false);
    setReviewHistory([]);
    setViewingHistoryIndex(null);
    clearSrsSession();
  }

  /**
   * Leave the dictionary batch and go back to the learner's own training setup.
   *
   * This is the way out of «тренировать эту пачку», and it is the whole reason
   * the batch is never written into the saved filters: the configuration the
   * learner built for themselves is still sitting in the profile, so coming
   * back to it is one call to resolveCardFilters with no batch.
   */
  function startSavedTraining() {
    const restored = resolveCardFilters(profile.cardFilters, null);
    setBatch(null);
    onExitBatch?.();
    setFilterStatus(restored.filterStatus);
    setFilterType(restored.filterType);
    setFilterBook(restored.filterBook);
    setFilterLevel(restored.filterLevel);
    setTrainFilter(restored.trainFilter);
    setTrainStatus(restored.trainStatus);
    setTrainBook(restored.trainBook);
    setTrainSourceId(restored.trainSourceId);
    setTrainExcluded(restored.trainExcluded);
    setTrainVariants(restored.trainVariants);
    setTrainMode(restored.trainMode);
    startTrainingSession(
      restored.trainStatus,
      restored.trainFilter,
      restored.trainVariants,
      restored.trainBook,
      restored.trainSourceId,
      false,
      restored.trainExcluded,
    );
  }

  /**
   * Train around a source instead of through it.
   *
   * Restarts the session, because the queue was built before the learner
   * changed their mind about what belongs in it — leaving the cards they just
   * excluded sitting in front of them would be the filter agreeing and doing
   * nothing.
   */
  function setExcludedSources(excluded: string[]) {
    setTrainExcluded(excluded);
    persistCardFilters({ trainExcluded: excluded });
    startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, drilling, excluded);
  }

  /**
   * Train one source and nothing else — or, with null, the deck again.
   *
   * A source with a pack row behind it is matched by its id: two pages
   * photographed on the same day can carry the same title, and matching by
   * title would quietly train both.
   */
  function selectTrainingSource(source: CardSource | null) {
    leaveBatchForOwnChoice();
    const book = source ? source.title : "all";
    const sourceId = source?.packId ?? null;
    setTrainBook(book);
    setTrainSourceId(sourceId);
    persistCardFilters({ trainBook: book, trainSourceId: sourceId });
    startTrainingSession(trainStatus, trainFilter, trainVariants, book, sourceId, drilling, trainExcluded);
  }

  function toggleExcludedSource(key: string) {
    setExcludedSources(
      trainExcluded.includes(key) ? trainExcluded.filter((k) => k !== key) : [...trainExcluded, key],
    );
  }

  /** Picking a source by hand is a deliberate choice, so it ends the batch. */
  function leaveBatchForOwnChoice() {
    if (!batch) return;
    setBatch(null);
    onExitBatch?.();
  }

  const handleGrade = (score: 1 | 2 | 3 | 4) => {
    if (viewingHistoryIndex !== null || trainQueue.length === 0 || currentTrainIndex >= trainQueue.length) return;
    const { card, variant } = trainQueue[currentTrainIndex];
    const prev = getVariantProgress(card, variant, variantProgress);
    const srsUpdate = calculateSM2(score, prev.repetitions, prev.lapses, prev.intervalDays, prev.easeFactor);
    const now = new Date().toISOString();
    if (variant === "forward") {
      onUpdateCard({ ...card, ...srsUpdate, lastReviewedAt: now });
    } else {
      const progress = { ...srsUpdate, lastReviewedAt: now };
      saveCardVariantProgress(card.id, variant, progress);
      setVariantProgress(getCardVariantProgressMap());
      if (user) void sbUpsertCardVariantProgress(user.id, [{ cardId: card.id, variant, progress }]);
      // The card's own lastReviewedAt is deliberately left alone: it is the
      // recognition prompt's record, and stamping it here counted one graded
      // reverse prompt as two reviews in «сделано сегодня». The streak reads
      // every direction's timestamp, so today's activity is seen either way.
    }

    setReviewHistory((history) => [...history, { card, variant }]);
    const nextReviewedIds = [...reviewedIds, card.id];
    const nextIndex = currentTrainIndex + 1;
    setReviewedIds(nextReviewedIds);
    saveSrsSession(nextReviewedIds, nextIndex);

    setIsFlipped(false);
    setTimeout(() => setCurrentTrainIndex(nextIndex), 250);
  };

  const restartTraining = () => startTrainingSession(trainStatus, trainFilter, trainVariants);

  /**
   * Go through the same selection again, schedule or no schedule.
   *
   * This is what «пройти пачку заново» has to mean. The old button rebuilt an
   * ordinary queue, which asks "what is due"; every card had been graded
   * seconds earlier, so the honest answer was "nothing", and the learner was
   * shown «нет карточек по выбранным фильтрам» over a pack they had just
   * finished. A first pass through new material is not a review — it is
   * repetition until the words stop being strangers — so this takes everything
   * in scope. Grading still schedules exactly as before.
   */
  const drillAgain = () =>
    startTrainingSession(trainStatus, trainFilter, trainVariants, trainBook, trainSourceId, true);

  /**
   * Switch the direction being drilled without leaving the card.
   *
   * The way a pack is actually learned is a sequence: read it изучаемый →
   * родной first, then turn it round and produce it, then do it by ear. Each
   * of those was three taps into a filter panel; here it is one, right above
   * the card, and it keeps the session's drill setting so a second pass
   * through a pack does not empty itself out.
   */
  const switchDirection = (variant: TrainVariant) => {
    const variants = [variant];
    setTrainVariants(variants);
    persistCardFilters({ trainVariants: variants });
    startTrainingSession(trainStatus, trainFilter, variants, trainBook, trainSourceId, drilling);
  };

  const openLatestReviewedCard = () => {
    if (reviewHistory.length === 0) return;
    setViewingHistoryIndex(reviewHistory.length - 1);
  };

  const closeReviewedCard = () => setViewingHistoryIndex(null);

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

  // Zen is a way of working, not a one-off view, so the choice is remembered
  // the same way the filters are: a learner who trains this way trains this way
  // tomorrow too, without hunting for the button again.
  const setZen = useCallback((on: boolean) => {
    setZenMode(on);
    persistCardFilters({ zenMode: on });
  }, [persistCardFilters]);

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
  // The dictionary knows each word's part of speech and level; cards do not
  // carry them. Fetched once when the module opens, matched by the card's
  // front, so a card made from a photographed page shows «сущ. · A1» without a
  // schema change. Cards from the reader fall back to the heuristic below.
  const [wordFacts, setWordFacts] = useState<Map<string, WordFacts>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dictionary", { headers: await sbAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json() as { entries?: { headword: string; lemma: string; part_of_speech: string; cefr: string }[] };
        if (cancelled) return;
        const map = new Map<string, WordFacts>();
        for (const e of data.entries ?? []) {
          const fact = { pos: e.part_of_speech ?? "", cefr: e.cefr ?? "" };
          map.set(normalizeFront(e.headword), fact);
          map.set(normalizeFront(e.lemma), fact);
        }
        setWordFacts(map);
      } catch {
        // Chips simply fall back to the heuristic.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Which card's story is being written, so its button can spin.
  const [miniStory, setMiniStory] = useState<string | null>(null);

  /**
   * A short text built around the card's word, saved into «Мои уроки».
   *
   * It does not open the text: this fires mid-training, and yanking the
   * learner out of a session they are halfway through would cost more than
   * the text is worth. The toast says where it went.
   */
  async function createMiniStory(card: Flashcard) {
    if (miniStory) return;
    setMiniStory(card.id);
    try {
      const res = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
        body: JSON.stringify({
          level: ["A1", "A2", "B1", "B2", "C1", "C2"].includes(card.cefr ?? "") ? card.cefr : "A2",
          topic: `Слово «${card.front}»`,
          targetLanguage,
          nativeLanguage,
          reviewWords: [card.front],
          length: "short",
          context: `Короткий рассказ вокруг слова «${card.front}» (${card.back.split("\n")[0]}): показать его в нескольких типичных ситуациях и формах.`,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Не удалось создать рассказ.");
      showToast("✓ Рассказ сохранён в «Мои уроки»");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Не удалось создать рассказ.");
    } finally {
      setMiniStory(null);
    }
  }

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

  /**
   * «Как это сказать» for one word of a native-language prompt.
   *
   * Cached under its own key so it can never be confused with the ordinary
   * analysis of a word that happens to be spelled the same — the two answers
   * are in different languages.
   */
  const openReverseWordFor = useCallback(async (word: string, sentence: string) => {
    const norm = word.trim();
    if (!norm) return;

    setReverseWord({ open: true, word: norm, analysis: null, loading: true });

    const cacheKey = makeAiCacheKey("reverse-word", norm, targetLanguage, nativeLanguage);
    const cached = getLocalAiAnalysis(cacheKey);
    if (cached?.reverse?.entries?.length) {
      setReverseWord({ open: true, word: norm, analysis: cached.reverse, loading: false });
      return;
    }

    try {
      const result = await analyzeSelection({
        mode: "word",
        direction: "native-to-target",
        word: norm,
        text: norm,
        sentence: sentence || norm,
        sentenceBefore: "",
        sentenceAfter: "",
        nativeLanguage,
        targetLanguage,
      });
      if (result.reverse?.entries?.length) saveLocalAiAnalysis(cacheKey, result);
      setReverseWord({ open: true, word: norm, analysis: result.reverse ?? null, loading: false });
    } catch {
      setReverseWord({ open: true, word: norm, analysis: null, loading: false });
    }
  }, [targetLanguage, nativeLanguage]);

  // Bound to the prompt it belongs to, so the sentence the word sits in can
  // pick the right sense of it.
  const handleNativeWordTap = useCallback((word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const sentence = (e.currentTarget as HTMLElement | null)?.closest(".card-text-area")?.textContent ?? "";
    void openReverseWordFor(word, sentence.trim());
  }, [openReverseWordFor]);

  // --- Dynamic font size for card text ---
  /**
   * How big the prompt is set, from how much of it there is.
   *
   * Fixed pixel sizes were tuned on a wide screen and a single German word;
   * a whole sentence — or its Russian translation, which runs a third longer —
   * arrived at 22px on a 360px phone and had nowhere to go. These scale with
   * the viewport between a floor that stays readable and a ceiling that keeps
   * a short word looking like a headline.
   */
  function cardFontSize(text: string): string {
    if (text.length > 200) return "clamp(12px, 3.2vw, 14px)";
    if (text.length > 120) return "clamp(13px, 3.8vw, 16px)";
    if (text.length > 60) return "clamp(15px, 4.4vw, 19px)";
    if (text.length > 28) return "clamp(17px, 5.4vw, 23px)";
    return "clamp(20px, 6.6vw, 28px)";
  }

  // --- All Cards filtering & sorting ---
  const allBooks = useMemo(
    () => Array.from(new Set(cards.map((c) => c.sourceBookTitle || c.source || "").filter(Boolean))),
    [cards],
  );
  // Only levels that actually occur — cards made before levels existed have none.
  const cardLevels = useMemo(
    () => ["A1", "A2", "B1", "B2", "C1", "C2"].filter((l) => cards.some((c) => c.cefr === l)),
    [cards],
  );
  const activeFilterCount = [filterStatus !== "all", filterType !== "all", filterBook !== "all", filterLevel !== "all"].filter(Boolean).length;
  const variantsAreDefault = trainVariants.length === 1 && trainVariants[0] === "forward";
  // With one source picked there is nothing for the exclusions to remove — the
  // chips stay visible (so the learner can see what they set) but say so.
  const narrowedToOneSource = trainBook !== "all" || Boolean(trainSourceId);
  // Which row the picker shows a tick against, and what the summary names.
  const selectedSource = useMemo(
    () => cardSources.find((source) => (trainSourceId ? source.key === trainSourceId : source.title === trainBook)) ?? null,
    [cardSources, trainSourceId, trainBook],
  );
  const activeTrainFilterCount = [trainFilter !== "all", trainStatus !== "all", trainBook !== "all", trainExcluded.length > 0, !variantsAreDefault].filter(Boolean).length;

  const filteredAllCards = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return cards
      .filter((c) => {
        if (filterStatus !== "all" && c.status !== filterStatus) return false;
        if (filterType !== "all" && c.type !== filterType) return false;
        if (filterBook !== "all" && (c.sourceBookTitle || c.source || "") !== filterBook) return false;
        if (filterLevel !== "all" && (c.cefr ?? "") !== filterLevel) return false;
        if (query) return c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query) || (c.sourceBookTitle || c.source || "").toLowerCase().includes(query);
        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "due") return Date.parse(a.dueAt) - Date.parse(b.dueAt);
        if (sortOrder === "ease") return a.easeFactor - b.easeFactor;
        return Date.parse(b.addedAt) - Date.parse(a.addedAt);
      });
  }, [cards, filterStatus, filterType, filterBook, filterLevel, searchQuery, sortOrder]);

  // Both long lists page in as they are scrolled: rendering 500-plus rows at
  // once cost more than everything else on the screen put together.
  const visibleCards = useMemo(() => filteredAllCards.slice(0, visibleCount), [filteredAllCards, visibleCount]);
  const visibleDueCards = useMemo(() => dueCards.slice(0, visibleCount), [dueCards, visibleCount]);
  const hasMoreRows = activeTab === "today"
    ? visibleCount < dueCards.length
    : visibleCount < filteredAllCards.length;

  // --- Infinite scroll for the long lists (Today and All Cards) ---
  // Re-attached whenever the sentinel could have been unmounted, so a list that
  // shrinks below one page and grows again keeps paging.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((n) => n + 50); },
      { rootMargin: "200px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [activeTab, hasMoreRows]);

  // Today's plan is what has been done plus what is left, so the bar fills as
  // the session runs and stretches honestly when new cards are added mid-day.
  const todayPlanned = stats.reviewedToday + stats.dueReps;
  const todayDonePct = todayPlanned > 0 ? Math.round((stats.reviewedToday / todayPlanned) * 100) : 100;

  const openDiscussCallback = useCallback((card: Flashcard) => { void openDiscussForCard(card); }, [targetLanguage, nativeLanguage, user]);

  const currentItem = trainQueue[currentTrainIndex];
  const currentCard = currentItem?.card as Flashcard;
  const currentVariant: TrainVariant = currentItem?.variant ?? "forward";
  const isReversed = currentVariant === "reverse";
  const isAudio = currentVariant === "audio";
  const backParts = splitCardBack(currentCard?.back ?? "");
  const promptText = isReversed ? backParts.meaning : currentCard?.front;
  const answerText = isReversed ? currentCard?.front : currentCard?.back;
  const promptLang = isReversed ? nativeLanguage : targetLanguage;
  const currentProgress = currentCard ? getVariantProgress(currentCard, currentVariant, variantProgress) : null;
  const historyPosition = getReviewHistoryPosition(reviewHistory.length, viewingHistoryIndex);
  const historyItem = historyPosition ? reviewHistory[historyPosition.index] : null;
  const historyCard = historyItem?.card;
  const historyBackParts = splitCardBack(historyCard?.back ?? "");

  // Zen only takes over while there is a card to sit alone on the screen. The
  // finished-session summary, an empty queue and the productive trainer all
  // keep the ordinary page — which is also what makes the queue running out a
  // way back to the rest of the module rather than a dead end.
  const zenActive = zenMode
    && activeTab === "train"
    && trainMode === "recognize"
    && trainQueue.length > 0
    && currentTrainIndex < trainQueue.length;

  // A full-screen trainer over a scrolled page would otherwise let the page
  // behind it move under the finger — the very thing zen exists to stop.
  useEffect(() => {
    if (!zenActive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [zenActive]);

  // --- Keyboard control for the recognize trainer ---
  //
  // Bound only while a card is actually on screen, and never over a modal or a
  // field the learner is typing into, so the digits stay available to the
  // search box and the chat.
  const hotkeysActive = activeTab === "train"
    && trainMode === "recognize"
    && !wordModal.open
    && !reverseWord.open
    && !showKeysModal
    && !discuss.open
    && (Boolean(currentCard) || Boolean(historyPosition));

  useEffect(() => {
    if (!hotkeysActive) return;

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = trainerHotkey(e, { playerOpen });
      if (!action) return;

      // Browsing a graded card is read-only by design, so the keys that would
      // change it do nothing rather than quietly rescheduling a card the
      // learner is only looking at.
      const browsing = historyPosition !== null;
      const speakTarget = browsing ? historyCard : currentCard;

      switch (action.kind) {
        case "grade":
          if (browsing || !currentCard) return;
          handleGrade(action.score);
          break;
        case "speak":
          if (!speakTarget) return;
          void speak(speakTarget.front, targetLanguage);
          break;
        case "respeak":
          // Same rule as the button on the card: what is spoken is always the
          // language being learned, whichever side is showing.
          if (!speakTarget) return;
          void respeak(speakTarget.front, targetLanguage);
          break;
        case "playerRepeat":
          toggleRepeat();
          break;
        case "playerClose":
          stopTTS();
          break;
        case "flip":
          if (browsing || !currentCard) return;
          setIsFlipped((f) => !f);
          break;
        case "story":
          if (browsing || !currentCard) return;
          void createMiniStory(currentCard);
          break;
        case "discuss":
          if (!speakTarget) return;
          void openDiscussForCard(speakTarget);
          break;
        case "historyOlder":
          if (reviewHistory.length === 0) return;
          // Not yet browsing: the first step back opens the card just graded.
          if (!historyPosition) openLatestReviewedCard();
          else if (historyPosition.canGoOlder) setViewingHistoryIndex(historyPosition.index - 1);
          break;
        case "historyNewer":
          if (!historyPosition) return;
          // Past the newest reviewed card is the live one, which is where the
          // «Следующая» button leads too.
          if (historyPosition.canGoNewer) setViewingHistoryIndex(historyPosition.index + 1);
          else closeReviewedCard();
          break;
        case "live":
          closeReviewedCard();
          break;
        case "zenExit":
          // Escape means "give me the page back". With nothing hidden there is
          // nothing to escape from, so the key is left to the browser.
          if (!zenActive) return;
          setZen(false);
          break;
      }
      e.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeysActive, playerOpen, historyPosition?.index, historyPosition?.canGoOlder, historyPosition?.canGoNewer, reviewHistory.length, currentCard?.id, historyCard?.id, targetLanguage, currentTrainIndex, trainQueue, viewingHistoryIndex, miniStory, zenActive, setZen]);

  return (
    <section
      className={`screen${zenActive ? " srs-zen" : ""}`}
      onClick={() => { setShowFilterPanel(false); setShowTtsMenu(false); }}
    >
      <style>{`
        /* Glass, not a lid. It has to hide what scrolls under it — a
           transparent sticky bar let the statistics run through the title,
           which read as two screens printed on top of each other — but a flat
           fill of --bg-primary painted a black rectangle over the warm glow the
           app-shell puts at the top of every screen, and that rectangle was the
           first thing on the page. A blurred, slightly translucent panel does
           the hiding without the hole. */
        .srs-sticky-header { position: sticky; top: 0; z-index: 30; margin: -20px -16px 16px; padding: 16px 16px 10px; border-bottom: 1px solid var(--border); background: rgba(30, 27, 22, 0.72); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%); }
        /* Where the browser cannot blur, fall back to a fill opaque enough to
           hide the scrolling content — the panel is still warm, not black. */
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .srs-sticky-header { background: var(--bg-secondary); }
        }
        @media (min-width: 640px) { .srs-sticky-header { margin: -28px -24px 16px; padding: 24px 24px 10px; } }
        .srs-tabs-container { display: flex; gap: 4px; padding: 4px; margin-bottom: 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .srs-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 4px; background: transparent; border: none; border-radius: var(--radius-md); font-weight: 700; font-size: 13px; color: var(--text-muted); transition: all 0.2s; cursor: pointer; }
        .srs-tab.active { color: var(--accent); background: var(--bg-card); box-shadow: var(--shadow-sm); }
        .srs-tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 10px; font-weight: 800; }
        .srs-tab-badge.empty { background: rgba(240, 230, 211, 0.08); color: var(--text-muted); }
        .srs-tab.active .srs-tab-badge:not(.empty) { background: var(--accent); color: var(--bg-primary); }
        .srs-stats-banner { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
        .srs-today { padding: 11px 13px 9px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
        .srs-today-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
        .srs-today-lead { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
        .srs-today-remaining { font-size: 27px; font-weight: 900; line-height: 1; color: var(--accent); font-variant-numeric: tabular-nums; }
        .srs-today-lbl { font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-today-side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; flex-shrink: 0; }
        .srs-today-done { font-size: 13px; font-weight: 850; font-variant-numeric: tabular-nums; }
        .srs-today-sub { font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-today-bar { height: 6px; margin: 9px 0 8px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.08); }
        .srs-today-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--green)); transition: width 0.35s ease; }
        .srs-today-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .srs-today-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 750; color: var(--text-muted); white-space: nowrap; }
        .srs-today-foot .srs-stats-toggle { margin-left: auto; width: auto; height: 26px; padding: 0 9px; gap: 5px; font-size: 11px; font-weight: 800; }
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
        .flipper-card { width: 100%; position: relative; display: grid; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; }
        .flipper-card.flipped { transform: rotateY(180deg); }
        /* Three rows that know their own place: the actions, the text, the
           footer. The column is minmax(0, 1fr) rather than the implicit auto —
           an auto column is sized by its widest item's min-content, and the
           footer's single nowrap line (a source title can be a whole lesson
           name) blew that column past the card, which is what pushed long
           sentences off the right-hand edge instead of wrapping them. */
        .flipper-face { grid-area: 1 / 1; position: relative; width: 100%; min-width: 0; min-height: 200px; max-height: min(62vh, 560px); backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: var(--radius-lg); border: 1px solid var(--border-strong); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; gap: 10px; padding: 12px 14px; box-shadow: var(--shadow-sm); overflow: hidden; }
        .flipper-face-front { background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(212, 168, 71, 0.04) 100%); }
        .flipper-face-back { pointer-events: none; background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(122, 171, 106, 0.04) 100%); transform: rotateY(180deg); }
        .flipper-card.flipped .flipper-face-front { pointer-events: none; }
        .flipper-card.flipped .flipper-face-back { pointer-events: auto; }
        .card-actions-right { grid-row: 1; grid-column: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
        .card-action-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background: var(--bg-card); color: var(--text-primary); cursor: pointer; transition: all 0.18s ease; padding: 0; box-shadow: var(--shadow-xs); }
        .card-action-btn:hover:not(:disabled) { background: var(--bg-elevated); border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
        .card-action-btn:active:not(:disabled) { transform: scale(0.95); }
        .card-action-btn:disabled { opacity: 0.5; cursor: default; }
        .card-actions-right .speak-btn { width: 44px; height: 44px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background: var(--bg-card); color: var(--accent); transition: all 0.18s ease; box-shadow: var(--shadow-xs); }
        .card-actions-right .speak-btn:hover { background: var(--bg-elevated); border-color: var(--accent); transform: translateY(-1px); }
        .card-actions-right .speak-btn:active { transform: scale(0.95); }
        /* A sentence that outgrows even the tallest card scrolls inside it
           rather than reflowing the page under the grade buttons. */
        .card-text-area { grid-row: 2; grid-column: 1; min-width: 0; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; overflow-wrap: anywhere; word-break: break-word; hyphens: auto; text-align: center; }
        .card-text-area > * { min-width: 0; max-width: 100%; }
        .card-footer-row { grid-row: 3; grid-column: 1; align-self: end; min-width: 0; width: 100%; display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
        .card-footer-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-tts-wrap { position: relative; flex-shrink: 0; }
        .tts-menu { position: absolute; top: calc(100% + 6px); right: 0; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 4px; z-index: 200; min-width: 130px; box-shadow: var(--shadow-sm); }
        .tts-menu-item { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-primary); transition: background 0.15s; white-space: nowrap; }
        .tts-menu-item:hover { background: var(--bg-elevated); }
        .tts-menu-item.active { color: var(--accent); }
        .srs-grade-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 100%; max-width: 420px; margin: 0 auto; }
        .srs-keys-link { display: none; }
        @media (hover: hover) and (pointer: fine) {
          .srs-keys-link { display: inline-flex; align-items: center; gap: 5px; margin: 12px auto 0; padding: 4px 8px; border: none; border-radius: 999px; background: transparent; color: var(--text-muted); font-size: 10.5px; font-weight: 700; cursor: pointer; transition: color 0.18s; }
          .srs-keys-link:hover { color: var(--accent); }
        }
        /* The three directions, in the open above the card. Fully rounded, the
           same shape as the mode switch beside them — a pill next to a
           near-rectangle is the mismatch that made this row look unfinished. */
        /* What the sources are set to, in one line. The list itself is behind
           it, because the list can be a thousand rows long. */
        .srs-source-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); cursor: pointer; text-align: left; transition: all 0.18s ease; }
        .srs-source-btn:hover { border-color: var(--border-strong); }
        .srs-source-btn.active { border-color: var(--accent); color: var(--accent); }
        .srs-source-btn svg { flex-shrink: 0; }
        .srs-source-btn-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-source-btn-copy strong { font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-source-btn-copy small { font-size: 11px; color: var(--text-muted); }
        .srs-dir-row { display: flex; justify-content: center; gap: 6px; width: 100%; max-width: 420px; margin: 0 auto; flex-wrap: wrap; }
        .srs-dir-chip { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); font-size: 12px; font-weight: 750; cursor: pointer; transition: all 0.18s ease; }
        .srs-dir-chip:hover { border-color: var(--border-strong); color: var(--text-primary); }
        .srs-dir-chip.active { border-color: var(--accent); background: var(--accent); color: var(--bg-primary); }
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
        .srs-history-open { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; max-width: 420px; margin: 10px auto 0; padding: 9px 12px; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .srs-history-open:hover { border-color: var(--border); background: var(--bg-elevated); color: var(--text-primary); }
        .srs-history-open-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; line-height: 1.2; }
        .srs-history-open-copy strong { font-size: 12px; font-weight: 800; }
        .srs-history-open-copy small { font-size: 10px; color: var(--text-muted); }
        .srs-history-view { width: 100%; max-width: 420px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
        .srs-history-banner { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(122, 171, 106, 0.25); border-radius: var(--radius-md); background: rgba(122, 171, 106, 0.07); color: var(--green); }
        .srs-history-banner-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-history-banner-copy strong { font-size: 12px; font-weight: 850; }
        .srs-history-banner-copy span { font-size: 10px; color: var(--text-muted); }
        .srs-history-close { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
        .srs-history-close:hover { background: rgba(240, 230, 211, 0.08); color: var(--text-primary); }
        .srs-history-card { position: relative; min-height: 250px; display: flex; flex-direction: column; justify-content: center; padding: 56px 22px 46px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: linear-gradient(145deg, var(--bg-elevated), rgba(122, 171, 106, 0.04)); box-shadow: var(--shadow-sm); text-align: center; overflow: hidden; }
        .srs-history-card-head { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .srs-history-direction { padding: 4px 8px; border-radius: 6px; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.04em; }
        .srs-history-word-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .srs-history-word { min-width: 0; font-size: clamp(22px, 7vw, 30px); font-weight: 850; line-height: 1.25; overflow-wrap: anywhere; }
        .srs-history-divider { width: 42px; height: 1px; margin: 16px auto 13px; background: var(--border-strong); }
        .srs-history-label { margin-bottom: 5px; color: var(--text-muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
        .srs-history-meaning { color: var(--accent); font-size: 18px; font-weight: 750; line-height: 1.35; white-space: pre-line; overflow-wrap: anywhere; }
        .srs-history-details { margin-top: 7px; color: var(--text-muted); font-size: 13px; line-height: 1.4; white-space: pre-line; overflow-wrap: anywhere; }
        .srs-history-source { position: absolute; left: 14px; right: 14px; bottom: 14px; overflow: hidden; color: var(--text-muted); font-size: 11px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
        .srs-history-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .srs-history-nav-btn { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 42px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.18s ease; }
        .srs-history-nav-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .srs-history-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .all-search-bar { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--bg-card); border-radius: var(--radius-sm); padding: 0 12px; height: 40px; margin-bottom: 12px; min-width: 0; }
        .all-search-input { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text-primary); outline: none; font-size: 14px; }
        .card-row-delete-btn { color: var(--text-muted); background: transparent; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
        .card-row-delete-btn:hover { color: #e08888; background: rgba(224, 136, 136, 0.08); }
        .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .filter-chip { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.2s; white-space: nowrap; }
        .filter-chip.active { background: rgba(212, 168, 71, 0.15); border-color: var(--accent); color: var(--accent); }
        .book-select { width: 100%; max-width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; color: var(--text-muted); font-size: 12px; font-weight: 700; padding: 5px 10px; cursor: pointer; outline: none; }
        .book-select:focus { border-color: var(--accent); color: var(--accent); }
        .all-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .all-toolbar .all-search-bar { flex: 1; margin-bottom: 0; }
        .all-filter-toggle { display: flex; align-items: center; gap: 6px; padding: 0 14px; height: 40px; flex-shrink: 0; white-space: nowrap; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .all-filter-toggle.active { border-color: var(--accent); color: var(--accent); }
        .all-filter-count { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: var(--bg-primary); font-size: 10px; font-weight: 800; }
        .all-filter-panel { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm); }
        .filter-group-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
        .filter-reset-btn { align-self: flex-start; font-size: 12px; font-weight: 700; color: var(--text-muted); background: transparent; border: none; cursor: pointer; padding: 4px 0; text-decoration: underline; }
        .filter-reset-btn:hover { color: var(--accent); }
        .srs-stats-toggle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .srs-stats-toggle:hover, .srs-stats-toggle.active { background: rgba(212, 168, 71, 0.12); color: var(--accent); }
        .srs-stats-panel { display: flex; flex-direction: column; gap: 18px; padding: 14px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-sm); }
        .srs-stats-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
        .srs-stats-section-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-primary); }
        .srs-stats-note { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--text-muted); text-align: right; }
        .srs-stats-empty { font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-bar-row { display: flex; align-items: center; gap: 9px; padding: 3px 0; }
        .srs-bar-label { flex-shrink: 0; width: 108px; font-size: 11px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-bar-track { flex: 1; min-width: 0; height: 9px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.08); }
        .srs-bar-track i { display: block; height: 100%; border-radius: 99px; transition: width 0.35s ease; }
        .srs-bar-value { flex-shrink: 0; min-width: 64px; text-align: right; font-size: 11px; font-weight: 850; font-variant-numeric: tabular-nums; }
        .srs-bar-value small { font-weight: 700; color: var(--text-muted); }
        .srs-stats-legend-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 9px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-stats-legend-row span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-stats-legend-row i { width: 8px; height: 8px; border-radius: 2px; }
        .srs-stats-insight { padding: 10px 12px; border-radius: var(--radius-sm); background: rgba(212, 168, 71, 0.08); border: 1px solid rgba(212, 168, 71, 0.2); font-size: 12px; font-weight: 700; line-height: 1.4; color: var(--text-primary); }
        .srs-stat-bar { display: flex; height: 8px; width: 100%; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.07); }
        .srs-stat-bar i { display: block; height: 100%; }
        .srs-stat-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-stat-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-stat-legend i { width: 8px; height: 8px; border-radius: 2px; }
        .srs-forecast { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; height: 88px; }
        /* Four rows — number, bar, weekday, date — so the bars are measured
           against a track of their own. Sized as a share of the whole column,
           they came out compressed and a peak twice another's size barely
           looked taller. */
        .srs-forecast-col { display: grid; grid-template-rows: auto 1fr auto auto; justify-items: center; gap: 2px; min-width: 0; }
        .srs-forecast-track { display: flex; align-items: flex-end; width: 100%; height: 100%; }
        /* One column, two stacked segments: what is still due sits above what
           has already been reviewed today. */
        .srs-forecast-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; min-height: 3px; }
        .srs-forecast-bar { width: 100%; min-height: 2px; background: rgba(212, 168, 71, 0.55); }
        .srs-forecast-stack > .srs-forecast-bar:first-child { border-radius: 3px 3px 0 0; }
        .srs-forecast-stack > .srs-forecast-bar:last-child { border-radius: 0 0 2px 2px; }
        .srs-forecast-stack > .srs-forecast-bar:only-child { border-radius: 3px 3px 2px 2px; }
        .srs-forecast-bar.done { background: var(--green); }
        .srs-forecast-bar.empty { background: rgba(212, 168, 71, 0.18); }
        .srs-forecast-lbl { font-size: 9px; font-weight: 700; color: var(--text-muted); white-space: nowrap; }
        .srs-forecast-date { font-size: 8px; font-weight: 700; color: rgba(240, 230, 211, 0.28); line-height: 1; }
        .srs-forecast-col.today .srs-forecast-lbl { color: var(--accent); }
        .srs-forecast-col.today .srs-forecast-val { color: var(--accent); }
        .srs-forecast-val { font-size: 10px; font-weight: 800; color: var(--text-primary); }
        .srs-forecast-key { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-forecast-key span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-forecast-key i { width: 8px; height: 8px; border-radius: 2px; background: rgba(212, 168, 71, 0.55); }
        .srs-forecast-key i.done { background: var(--green); }
        .srs-source-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 12px; }
        .srs-source-row:first-of-type { border-top: none; }
        .srs-source-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
        .srs-source-meta { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-source-due { flex-shrink: 0; min-width: 34px; text-align: right; font-size: 11px; font-weight: 800; color: var(--accent); }
        .srs-list-more { margin: 10px auto 0; padding: 9px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-muted); font-size: 12px; font-weight: 700; cursor: pointer; }
        .srs-list-more:hover { border-color: var(--accent); color: var(--accent); }
        .srs-batch-banner { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 460px; margin: 0 auto; padding: 9px 12px; border: 1px solid rgba(212, 168, 71, 0.3); border-radius: var(--radius-md); background: rgba(212, 168, 71, 0.08); color: var(--accent); }
        .srs-batch-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-batch-copy strong { font-size: 12px; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-batch-copy span { font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-batch-exit { flex-shrink: 0; padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-muted); font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.18s ease; }
        .srs-batch-exit:hover { border-color: var(--accent); color: var(--accent); }

        /* ── Zen: the trainer alone on the screen ──────────────────────────
           Everything the page carries around the card — header, counters,
           tabs, mode switch, filters — is chrome you read once and then scroll
           past a hundred times. Here it is simply not there: the card sits in
           the middle of the viewport with its four grades directly beneath it,
           so a session is a run of taps in one place with no scrolling between
           them. Kept under the player's z-index (40) and under the
           modals' so speaking, looking a word up and discussing all still work
           from inside it. */
        .srs-zen { position: fixed; inset: 0; z-index: 35; max-width: none; margin: 0; padding: 0; background: var(--bg-primary); overscroll-behavior: contain; }

        /* The !important through this block is not emphasis: several of the
           elements being hidden carry their layout in inline styles, and an
           override layer that only applies in zen has no other way to win. */
        .srs-zen .srs-sticky-header,
        .srs-zen .srs-today,
        .srs-zen .srs-stats-panel,
        .srs-zen .srs-tabs-container,
        .srs-zen .srs-train-controls,
        .srs-zen .srs-batch-banner,
        .srs-zen .srs-train-progress,
        .srs-zen .srs-keys-link, .srs-zen .srs-dir-row { display: none !important; }

        /* The scroll container, so a card taller than the screen can still be
            reached. Its bottom padding is the player's own strip, reserved
            whether or not anything is playing — that is the point: it used to
            be added only while the player was up, which moved the grades out
            from under a thumb already on its way down every time playback
            ended, and a missed tap grades the wrong card. */
        .srs-zen .srs-train-tab { position: absolute; inset: 0; gap: 0 !important; overflow-y: auto; overscroll-behavior: contain; padding: calc(env(safe-area-inset-top, 0px) + 8px) 14px calc(env(safe-area-inset-bottom, 16px) + 56px); }
        .srs-zen .srs-train-stage { min-height: 100%; }

        /* The card, its grades and the way back to the last one are one block,
            centred in the screen. The buttons are placed by the card and
            nothing else: they move only when the card does, which is only ever
            in answer to a tap. What must never move them is the player, and it
            cannot — the strip it floats over is reserved whether or not
            anything is playing.

            The centring is done with a pair of auto margins rather than
            justify-content so that the top line stays at the top, and so that
            a card too tall for the screen scrolls from its top edge instead of
            being cut off at both ends. */
        .srs-zen .zen-topbar { margin-bottom: auto; }
        .srs-zen .srs-train-stage::after { content: ""; margin-top: auto; }
        .srs-zen .flipper-perspective { margin-bottom: 12px !important; }
        .srs-zen .srs-history-view { margin-top: auto; margin-bottom: auto; }

        .zen-topbar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px; width: 100%; max-width: 420px; margin: 0 auto; padding: 2px 0 8px; background: var(--bg-primary); }
        .zen-progress { flex: 1; min-width: 0; height: 3px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.09); }
        .zen-progress i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width 0.35s ease; }
        .zen-count { flex-shrink: 0; font-size: 11px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .zen-topbar-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .zen-topbar-btn:hover { background: rgba(240, 230, 211, 0.08); color: var(--text-primary); }

        .srs-zen .srs-grade-row { margin-top: 0; margin-bottom: 0; }
        /* Straight under the grades, where it is in the ordinary trainer —
            quieter here, because in an empty screen a full block of text
            competes with the card. */
        .srs-zen .srs-history-open { margin-top: 6px; padding: 7px 12px; }

        .zen-toggle { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); cursor: pointer; transition: all 0.2s; }
        .zen-toggle:hover { border-color: var(--accent); color: var(--accent); }
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

      {/* «Как это сказать» — a word tapped on a native-language prompt */}
      <ReverseWordModal
        isOpen={reverseWord.open}
        isLoading={reverseWord.loading}
        word={reverseWord.word}
        analysis={reverseWord.analysis}
        lang={targetLanguage}
        onClose={() => setReverseWord((s) => ({ ...s, open: false }))}
        onAddCard={(front, back) => void addCard(front, back, "word", currentCard ?? null)}
      />

      {showKeysModal && <TrainerKeysModal onClose={() => setShowKeysModal(false)} />}

      {showSourcePicker && (
        <SourcePickerModal
          sources={cardSources}
          selectedKey={selectedSource?.key ?? null}
          excluded={trainExcluded}
          onSelect={(source) => selectTrainingSource(source)}
          onToggleExcluded={toggleExcludedSource}
          onClearExcluded={() => setExcludedSources([])}
          onClose={() => setShowSourcePicker(false)}
        />
      )}

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
          wordProfile={discussWordProfile}
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

      {/* Today's progress — the one line that has to move on every grade.
          It used to lead with the number of cards due, which only drops once
          all three of a card's directions are done: a learner could grade
          fifteen prompts and watch "177" sit there unchanged. Repetitions are
          the unit a session is actually counted in, so that is what leads. */}
      <div className="srs-today">
        <div className="srs-today-head">
          <div className="srs-today-lead">
            <span className="srs-today-remaining">{stats.dueReps}</span>
            <span className="srs-today-lbl">
              {stats.dueReps === 0 ? "на сегодня всё" : "повторений осталось"}
            </span>
          </div>
          <div className="srs-today-side">
            <span className="srs-today-done">{stats.reviewedToday} из {todayPlanned}</span>
            <span className="srs-today-sub">сделано сегодня · {stats.dueCards} карт.</span>
          </div>
        </div>
        <div className="srs-today-bar" role="progressbar" aria-valuenow={todayDonePct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${todayDonePct}%` }} />
        </div>
        <div className="srs-today-foot">
          <span className="srs-today-chip" title={`Лучшая серия: ${stats.bestStreak} дн.`}>
            <Flame size={12} fill={stats.streak > 0 ? "var(--accent)" : "none"} />
            {stats.streak} дн. подряд
          </span>
          <span className="srs-today-chip" title="Карточек, которые вы уже хотя бы раз повторили">
            {stats.learnedCards} из {stats.totalCards} изучено
          </span>
          <button
            className={`srs-stats-toggle ${showStats ? "active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShowStats((v) => !v); }}
            type="button"
            aria-expanded={showStats}
          >
            <BarChart3 size={13} /> Разбор
            <ChevronDown size={12} style={{ transform: showStats ? "rotate(180deg)" : undefined, transition: "transform 0.18s" }} />
          </button>
        </div>
      </div>

      {showStats && <StatsPanel stats={stats} onClick={(e) => e.stopPropagation()} />}

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
                <button
                  className="pill-btn"
                  onClick={() => { startSavedTraining(); setActiveTab("train"); }}
                  type="button"
                  title={batch ? "Начнёт обычную тренировку — фильтр пачки будет снят" : undefined}
                >
                  <Play size={14} fill="currentColor" /> Начать тренировку
                </button>
              </div>
              <div className="card-list">
                {visibleDueCards.map((card) => (
                  <DueCardRow key={card.id} card={card} skillState={skillProgress[card.id] ?? EMPTY_SKILL_STATE} />
                ))}
                {hasMoreRows && <div ref={sentinelRef} style={{ height: 1 }} />}
              </div>
              {hasMoreRows && (
                <button className="srs-list-more" type="button" onClick={() => setVisibleCount((n) => n + 50)}>
                  Показать ещё ({dueCards.length - visibleDueCards.length})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB: TRAINING */}
      {activeTab === "train" && (
        <div className="srs-train-tab" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* A batch narrows the deck without touching the saved filters, so it
              has to say so — otherwise a session pinned to one photographed
              page looks like the whole deck having gone missing. */}
          {batch && (
            <div className="srs-batch-banner">
              <Layers size={16} />
              <div className="srs-batch-copy">
                <strong>Пачка «{batch.title}»</strong>
                {/* A pack with a setup of its own has to say what it is, or the
                    trainer looks as if it quietly ignored the filters. */}
                <span>
                  {batchTrainingSummary
                    ? `Настройка пачки: ${batchTrainingSummary}`
                    : "Ваши обычные фильтры сохранены и вернутся"}
                </span>
                {batchTrainingNote && <span>{batchTrainingNote}</span>}
              </div>
              <button className="srs-batch-exit" type="button" onClick={startSavedTraining}>
                Выйти
              </button>
            </div>
          )}

          {/* Mode switch (passive recognition vs active production) + the
              filters toggle share one row so they don't cost extra vertical
              space above the fold. */}
          <div className="srs-train-controls" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div className="mode-switch">
              <button className={`mode-switch-opt ${trainMode === "recognize" ? "active" : ""}`} onClick={() => { setTrainMode("recognize"); persistCardFilters({ trainMode: "recognize" }); }} type="button">Узнавание</button>
              <button className={`mode-switch-opt ${trainMode === "active" ? "active" : ""}`} onClick={() => { setTrainMode("active"); persistCardFilters({ trainMode: "active" }); }} type="button">Активно</button>
            </div>
            {trainMode === "recognize" && (
              <button
                className={`all-filter-toggle pill ${showTrainFilterPanel ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); setShowTrainFilterPanel((v) => !v); }}
                type="button"
              >
                <SlidersHorizontal size={15} /> Фильтры
                {activeTrainFilterCount > 0 && <span className="all-filter-count">{activeTrainFilterCount}</span>}
                <ChevronDown size={12} />
              </button>
            )}
          </div>

          {/* Direction, in the open. It is the one setting that changes what
              a pass through a pack *is* — read it, produce it, or hear it —
              and burying it three taps deep in the filter panel made going
              round the same pack a second way an errand. */}
          {trainMode === "recognize" && (
            <div className="srs-dir-row" role="group" aria-label="Направление тренировки">
              {ALL_TRAIN_VARIANTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`srs-dir-chip${trainVariants.length === 1 && trainVariants[0] === v ? " active" : ""}`}
                  aria-pressed={trainVariants.length === 1 && trainVariants[0] === v}
                  onClick={(e) => { e.stopPropagation(); switchDirection(v); }}
                  title={TRAIN_VARIANT_LABELS[v]}
                >
                  {VARIANT_SHORT_LABELS[v]}
                </button>
              ))}
              <button
                type="button"
                className={`srs-dir-chip${trainVariants.length > 1 ? " active" : ""}`}
                aria-pressed={trainVariants.length > 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setTrainVariants([...ALL_TRAIN_VARIANTS]);
                  persistCardFilters({ trainVariants: [...ALL_TRAIN_VARIANTS] });
                  startTrainingSession(trainStatus, trainFilter, [...ALL_TRAIN_VARIANTS], trainBook, trainSourceId, drilling);
                }}
                title="Все направления вперемешку"
              >
                Всё
              </button>
            </div>
          )}

          {trainMode === "active" ? (
            <ProductiveTrainer
              cards={trainCards}
              targetLanguage={targetLanguage}
              onReviewed={(card) => onUpdateCard({ ...card, lastReviewedAt: new Date().toISOString() })}
            />
          ) : (
          <>
          {showTrainFilterPanel && (
            <div className="all-filter-panel" onClick={(e) => e.stopPropagation()}>
              {/* One control for the whole question of where the cards come
                  from. It used to be a select for «only this one» with a wall
                  of chips under it for «all but these» — thirty-five chips
                  buried every other filter in the panel, and the number of
                  packs only goes up. The summary says what is set; the picker
                  behind it has a search box and a page at a time. */}
              {cardSources.length > 1 && (
                <div className="filter-group">
                  <div className="filter-group-label">Источники</div>
                  <button
                    type="button"
                    className={`srs-source-btn${narrowedToOneSource || trainExcluded.length > 0 ? " active" : ""}`}
                    onClick={() => setShowSourcePicker(true)}
                  >
                    <Layers size={15} />
                    <span className="srs-source-btn-copy">
                      <strong>{selectedSource ? selectedSource.title : "Все источники"}</strong>
                      <small>
                        {trainExcluded.length > 0
                          ? `исключено: ${trainExcluded.length}`
                          : selectedSource
                            ? `${selectedSource.cards} ${cardNoun(selectedSource.cards)}`
                            : `${cardSources.length} ${sourceNoun(cardSources.length)}`}
                      </small>
                    </span>
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}

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
                        <span style={{ marginLeft: 4, opacity: 0.7 }}>{trainCounts.byType[t]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label">Статус</div>
                <div className="filter-chips">
                  {(["all", "new", "learning", "review", "relearning", "hard"] as TrainStatus[]).map((s) => {
                    const count = trainCounts.byStatus[s];
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
                  onClick={() => { leaveBatchForOwnChoice(); setTrainFilter("all"); setTrainStatus("all"); setTrainBook("all"); setTrainSourceId(null); setTrainExcluded([]); setTrainVariants(DEFAULT_TRAIN_VARIANTS); persistCardFilters({ trainFilter: "all", trainStatus: "all", trainBook: "all", trainSourceId: null, trainExcluded: [], trainVariants: DEFAULT_TRAIN_VARIANTS }); startTrainingSession("all", "all", DEFAULT_TRAIN_VARIANTS, "all", null, false, []); }}
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
                <p>
                  {drillCandidates > 0
                    ? "По расписанию на сегодня всё сделано. Но пройти этот набор ещё раз можно когда угодно — на расписание это не влияет."
                    : "Нет карточек для тренировки. Добавьте новые слова во время чтения."}
                </p>
                {drillCandidates > 0 && (
                  <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={drillAgain} type="button">
                    <RotateCcw size={14} style={{ marginRight: 6 }} /> Пройти заново ({drillCandidates})
                  </button>
                )}
                {/* Said out loud, because an exclusion made a while ago is
                    exactly the thing a learner will not think to look for when
                    the queue turns up empty. */}
                {trainExcluded.length > 0 && (
                  <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => setExcludedSources([])} type="button">
                    <EyeOff size={14} /> Исключено источников: {trainExcluded.length} — вернуть
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <AlertCircle size={40} />
                <strong>{drillCandidates > 0 ? "На сегодня по расписанию ничего нет" : "Нет карточек по выбранным фильтрам"}</strong>
                <p>
                  {trainStatus === "hard"
                    ? "Отлично — сложных карточек нет!"
                    : drillCandidates > 0
                      ? "Расписание решает, когда карточка вернётся сама. Пройти этот набор ещё раз можно когда угодно."
                      : "Попробуйте другой тип или статус."}
                </p>
                {/* The way out of the dead end the learner actually hit:
                    everything in this selection is scheduled for later, and
                    they want to go through it now anyway. */}
                {drillCandidates > 0 && (
                  <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={drillAgain} type="button">
                    <RotateCcw size={14} style={{ marginRight: 6 }} /> Пройти заново ({drillCandidates})
                  </button>
                )}
              </div>
            )
          ) : historyPosition && historyCard && historyItem ? (
            <div className="srs-history-view">
              <div className="srs-history-banner">
                <Eye size={17} />
                <div className="srs-history-banner-copy">
                  <strong>Просмотр пройденной карточки</strong>
                  <span>Не влияет на прогресс и расписание повторений</span>
                </div>
                <button className="srs-history-close" type="button" aria-label="Вернуться к обучению" onClick={closeReviewedCard}>
                  <X size={17} />
                </button>
              </div>

              <article className="srs-history-card">
                <div className="srs-history-card-head">
                  <span className="srs-history-direction">{TRAIN_VARIANT_LABELS[historyItem.variant]}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 750 }}>
                    {historyPosition.index + 1} из {reviewHistory.length}
                  </span>
                </div>

                <div className="srs-history-word-row">
                  <div className="srs-history-word">
                    <TokenizedText text={historyCard.front} style={{ fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit" }} onWordTap={handleWordTap} />
                  </div>
                  <SpeakButton text={historyCard.front} lang={targetLanguage} size={19} />
                </div>
                <div className="srs-history-divider" />
                <div className="srs-history-label">Перевод</div>
                <div className="srs-history-meaning">{historyBackParts.meaning || "—"}</div>
                {historyBackParts.details && <div className="srs-history-details">{historyBackParts.details}</div>}
                <div className="srs-history-source">{historyCard.sourceBookTitle || historyCard.source}</div>
              </article>

              <div className="srs-history-nav">
                <button
                  className="srs-history-nav-btn"
                  type="button"
                  disabled={!historyPosition.canGoOlder}
                  onClick={() => setViewingHistoryIndex(historyPosition.index - 1)}
                >
                  <ChevronLeft size={16} /> Предыдущая
                </button>
                <button
                  className="srs-history-nav-btn"
                  type="button"
                  onClick={() => historyPosition.canGoNewer
                    ? setViewingHistoryIndex(historyPosition.index + 1)
                    : closeReviewedCard()}
                >
                  {historyPosition.canGoNewer ? "Следующая" : "К обучению"} <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : currentTrainIndex >= trainQueue.length ? (
            <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
              <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
              <strong>{batch ? "Пачка пройдена!" : "Тренировка завершена!"}</strong>
              <p>
                {batch
                  ? `«${batch.title}» — все ${trainQueue.length} повторений сделаны. Отличная работа!`
                  : `Вы повторили все ${trainQueue.length} карточек. Отличная работа!`}
              </p>
              {/* The batch was a detour. Its cards are done, so the obvious next
                  step is the training the learner set up for themselves — which
                  is still exactly as they left it. */}
              {batch && (
                <button className="primary-btn" style={{ marginTop: 12, maxWidth: 280 }} onClick={startSavedTraining} type="button">
                  <Play size={14} fill="currentColor" style={{ marginRight: 6 }} /> Продолжить обычную тренировку
                </button>
              )}
              <button className="secondary-btn" style={{ marginTop: 12 }} onClick={drillAgain} type="button">
                <RotateCcw size={14} /> {batch ? "Пройти пачку заново" : "Начать заново"}
              </button>
              {/* Which is the point of a first pass: the same material, in the
                  other direction, straight away. */}
              <div className="srs-dir-row" style={{ marginTop: 12 }}>
                {ALL_TRAIN_VARIANTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`srs-dir-chip${trainVariants.length === 1 && trainVariants[0] === v ? " active" : ""}`}
                    onClick={() => switchDirection(v)}
                    title={`Пройти заново: ${TRAIN_VARIANT_LABELS[v]}`}
                  >
                    {VARIANT_SHORT_LABELS[v]}
                  </button>
                ))}
              </div>
              {reviewHistory.length > 0 && (
                <button className="srs-history-open" onClick={openLatestReviewedCard} type="button">
                  <Eye size={15} />
                  <span className="srs-history-open-copy">
                    <strong>Посмотреть последнюю карточку</strong>
                    <small>без изменения прогресса</small>
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="srs-train-stage" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* In zen, the whole of the surrounding page is reduced to this:
                  where you are in the queue, and the way out. */}
              {zenActive && (
                <div className="zen-topbar">
                  <span className="zen-count">{currentTrainIndex + 1} / {trainQueue.length}</span>
                  <div className="zen-progress" role="progressbar" aria-valuenow={Math.round((currentTrainIndex / trainQueue.length) * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${Math.round((currentTrainIndex / trainQueue.length) * 100)}%` }} />
                  </div>
                  <button className="zen-topbar-btn" onClick={(e) => { e.stopPropagation(); setZen(false); }} type="button" aria-label="Выйти из дзен-режима" title="Выйти из дзен-режима (Esc)">
                    <Minimize2 size={17} />
                  </button>
                </div>
              )}

              {/* Progress */}
              <div className="srs-train-progress" style={{ width: "100%", maxWidth: 420, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>
                <span>Карточка {currentTrainIndex + 1} из {trainQueue.length}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--accent)" }}>{Math.round((currentTrainIndex / trainQueue.length) * 100)}% пройдено</span>
                  {/* The way in, sat directly above the card it clears the
                      screen for. Deliberately not automatic: the page around
                      the card is where a session is set up, and it should still
                      be there when that is what the learner came for. */}
                  <button
                    className="zen-toggle"
                    onClick={(e) => { e.stopPropagation(); setZen(true); }}
                    type="button"
                    aria-label="Дзен-режим"
                    title="Дзен-режим — только карточка и оценки"
                  >
                    <Maximize2 size={15} />
                  </button>
                </span>
              </div>

              {/* Flipper card — height adapts to content */}
              <div className="flipper-perspective" style={{ marginBottom: 16 }}>
                <div className={`flipper-card ${isFlipped ? "flipped" : ""}`}>
                  {/* Front */}
                  <div className="flipper-face flipper-face-front" onClick={() => setIsFlipped((f) => !f)}>
                    {/* One row of actions across the top. There used to be a
                        stack of badges opposite them — type, part of speech,
                        level — which said what the card already says and cost
                        the text the whole top of the card. */}
                    <div className="card-actions-right">
                      <button
                        className="card-action-btn"
                        type="button"
                        aria-label="Мини-рассказ с этим словом"
                        title="Мини-рассказ с этим словом — сохранится в «Мои уроки»"
                        disabled={miniStory === currentCard.id}
                        onClick={(e) => { e.stopPropagation(); void createMiniStory(currentCard); }}
                      >
                        {miniStory === currentCard.id ? <Loader2 size={22} className="spin" /> : <FileText size={22} />}
                      </button>
                      <button
                        className="card-action-btn"
                        type="button"
                        aria-label="Обсудить с AI"
                        title="Обсудить с AI"
                        onClick={(e) => { e.stopPropagation(); void openDiscussForCard(currentCard); }}
                      >
                        <MessageCircle size={22} />
                      </button>
                      {/* Re-record. Shown wherever something is actually spoken:
                          a reversed prompt is the learner's own language and is
                          never read aloud, so there is nothing there to fix. */}
                      {!isReversed && (
                        <RespeakButton
                          text={isAudio ? currentCard.front : promptText}
                          lang={isAudio ? targetLanguage : promptLang}
                        />
                      )}
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
                          <SpeakButton text={promptText} lang={promptLang} size={22} />
                          {showTtsMenu && (
                            <div className="tts-menu" onClick={(e) => e.stopPropagation()}>
                              {ttsProvidersFor(targetLanguage).map((p) => (
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
                        /* Tappable, like the other side — but asking the
                           opposite question. One unknown word in a phrase the
                           learner otherwise understands used to cost them the
                           whole card: flipping it to find that one word gives
                           away the answer they were about to produce. */
                        <TokenizedText
                          text={promptText}
                          style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                          onWordTap={handleNativeWordTap}
                        />
                      ) : (
                        <TokenizedText
                          text={promptText}
                          style={{ fontSize: cardFontSize(promptText), fontWeight: 800, userSelect: "none", lineHeight: 1.3 }}
                          onWordTap={handleWordTap}
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
                    {(isReversed || isAudio) && (
                      <div className="card-actions-right">
                        <RespeakButton text={currentCard.front} lang={targetLanguage} />
                        <div className="card-tts-wrap" onClick={(e) => e.stopPropagation()}>
                          <SpeakButton text={currentCard.front} lang={targetLanguage} size={22} />
                        </div>
                      </div>
                    )}
                    <div className="card-text-area">
                      {isAudio ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <TokenizedText
                            text={currentCard.front}
                            style={{ fontSize: cardFontSize(currentCard.front), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3, textAlign: "center" }}
                            onWordTap={handleWordTap}
                          />
                          <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>{currentCard.back}</div>
                        </div>
                      ) : isReversed ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                          <TokenizedText
                            text={answerText}
                            style={{ fontSize: cardFontSize(answerText), fontWeight: 700, color: "var(--accent)", wordBreak: "break-word", lineHeight: 1.3 }}
                            onWordTap={handleWordTap}
                          />
                          {backParts.details && (
                            <div style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", whiteSpace: "pre-line" }}>
                              {backParts.details}
                            </div>
                          )}
                        </div>
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
              {reviewHistory.length > 0 && (
                <button className="srs-history-open" onClick={openLatestReviewedCard} type="button">
                  <Eye size={15} />
                  <span className="srs-history-open-copy">
                    <strong>Посмотреть предыдущую карточку</strong>
                    <small>без изменения прогресса</small>
                  </span>
                </button>
              )}

              {/* Only where there is a keyboard to press. On a touch screen a
                  list of keys would be instructions for something that does not
                  exist — and even on a desktop it is read once, so it is a line
                  rather than a wall under the card. */}
              <button
                type="button"
                className="srs-keys-link"
                onClick={(e) => { e.stopPropagation(); setShowKeysModal(true); }}
              >
                <Keyboard size={12} /> Горячие клавиши
              </button>
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

              {cardLevels.length > 0 && (
                <div className="filter-group">
                  <div className="filter-group-label">Уровень CEFR</div>
                  <div className="filter-chips">
                    <button className={`filter-chip ${filterLevel === "all" ? "active" : ""}`} onClick={() => { setFilterLevel("all"); persistCardFilters({ filterLevel: "all" }); setVisibleCount(50); }} type="button">Все</button>
                    {cardLevels.map((l) => (
                      <button key={l} className={`filter-chip ${filterLevel === l ? "active" : ""}`} onClick={() => { setFilterLevel(l); persistCardFilters({ filterLevel: l }); setVisibleCount(50); }} type="button">
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                <button className="filter-reset-btn" onClick={() => { setFilterStatus("all"); setFilterType("all"); setFilterBook("all"); setFilterLevel("all"); persistCardFilters({ filterStatus: "all", filterType: "all", filterBook: "all", filterLevel: "all" }); setVisibleCount(50); }} type="button">
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
                <AllCardRow
                  key={card.id}
                  card={card}
                  facts={wordFacts.get(normalizeFront(card.front))}
                  targetLanguage={targetLanguage}
                  onWordTap={handleWordTap}
                  onDiscuss={openDiscussCallback}
                  onDelete={onDeleteCard}
                />
              ))}
              {hasMoreRows && <div ref={sentinelRef} style={{ height: 1 }} />}
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

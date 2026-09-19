"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BarChart,
  BookOpenCheck,
  Brain,
  ChevronRight,
  Clock3,
  Languages,
  Phone,
  Target,
  X,
} from "lucide-react";
import { ALL_TRAIN_VARIANTS, computeDeckStats, getVariantProgress, type DeckStats } from "@/lib/cards";
import { getCardVariantProgressMap } from "@/lib/db/local";
import type { CefrLevel, Flashcard, TrainVariant, UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  cards: Flashcard[];
  onOpenLiveChat: () => void;
  onOpenLiveTranslate: () => void;
};

type Tone = "cyan" | "green" | "violet" | "orange";
type IntervalBucket = { label: string; count: number; tone: Tone };
type VariantProgressMap = ReturnType<typeof getCardVariantProgressMap>;

type SkillStat = {
  variant: TrainVariant;
  label: string;
  masteredPercent: number | null;
  averageInterval: number;
  errorsPerCard: number;
};

type VocabularyStats = {
  current: CefrLevel | null;
  next: CefrLevel | null;
  currentCount: number;
  nextCount: number;
  totalTagged: number;
  currentCorePercent: number | null;
  currentMasteryPercent: number | null;
  currentDisplay: string;
  currentLabel: string;
  nextLabel: string;
  nextTarget: number | null;
  currentBarPercent: number;
  nextBarPercent: number;
  totalWords: number;
  byType: Record<Flashcard["type"], number>;
};

type DashboardStats = {
  deck: DeckStats;
  wordCount: number;
  srsCardCount: number;
  reviewedCards: number;
  errorFreeCards: number;
  accuracy: number | null;
  longTermCards: number;
  longTermPercent: number | null;
  completedLessons: number;
  startedLessons: number;
  intervalBuckets: IntervalBucket[];
  skills: SkillStat[];
  vocabulary: VocabularyStats;
};

const LANGUAGE_NAMES: Record<string, string> = {
  de: "Немецкий язык",
  en: "Английский язык",
  es: "Испанский язык",
  fr: "Французский язык",
  it: "Итальянский язык",
};

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: "Начальный",
  A2: "Предпороговый",
  B1: "Пороговый",
  B2: "Продвинутый пороговый",
  C1: "Продвинутый",
  C2: "В совершенстве",
};

// These are vocabulary landmarks used only for the progress bar. They never
// decide the learner's CEFR by themselves: the level comes from the explicit
// CEFR labels attached to the learner's actual words.
const LEVEL_CORE_TARGETS: Record<CefrLevel, number> = {
  A1: 500,
  A2: 1200,
  B1: 2500,
  B2: 4000,
  C1: 8000,
  C2: 12000,
};

const VARIANT_LABELS: Record<TrainVariant, string> = {
  audio: "Аудирование (DE на слух)",
  reverse: "Чтение / узнавание (DE → RU)",
  forward: "Активный перевод (RU → DE)",
};

function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function oneDecimal(value: number | null) {
  return value === null ? "—" : `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function normalizeCefr(value: string | null | undefined): CefrLevel | null {
  const match = String(value ?? "").toUpperCase().match(/\b[ABC][12]\b/);
  return match && LEVELS.includes(match[0] as CefrLevel) ? match[0] as CefrLevel : null;
}

function uniqueWordCards(cards: Flashcard[]) {
  const wordCards = cards.filter((card) => card.type === "word");
  const source = wordCards.length > 0 ? wordCards : cards;
  const byWord = new Map<string, Flashcard>();

  for (const card of source) {
    const key = card.front.trim().toLocaleLowerCase();
    const previous = byWord.get(key);
    // Keep the copy that has the richer CEFR metadata when old duplicate cards
    // and newer dictionary cards share the same word.
    if (!previous || (!previous.cefr && card.cefr)) byWord.set(key, card);
  }

  return [...byWord.values()];
}

function analyzeVocabulary(cards: Flashcard[]): VocabularyStats {
  const words = uniqueWordCards(cards);
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0])) as Record<CefrLevel, number>;
  const mastered = Object.fromEntries(LEVELS.map((level) => [level, 0])) as Record<CefrLevel, number>;

  for (const card of words) {
    const level = normalizeCefr(card.cefr);
    if (!level) continue;
    counts[level] += 1;
    if (card.intervalDays >= 15 && card.lapses === 0) mastered[level] += 1;
  }

  const totalTagged = LEVELS.reduce((sum, level) => sum + counts[level], 0);
  // The dominant explicit vocabulary band is the current lexical zone. This
  // prevents one B2 book or one advanced word from claiming B2 for the learner.
  const current = LEVELS.reduce<CefrLevel | null>((best, level) => {
    if (counts[level] === 0) return best;
    if (!best || counts[level] > counts[best]) return level;
    return best;
  }, null);
  const currentIndex = current ? LEVELS.indexOf(current) : -1;
  const next = currentIndex >= 0 ? LEVELS[currentIndex + 1] ?? null : null;
  const currentCount = current ? counts[current] : 0;
  const nextCount = next ? counts[next] : 0;
  const currentMasteryPercent = current && currentCount > 0 ? Math.round((mastered[current] / currentCount) * 1000) / 10 : null;
  const currentCorePercent = current ? Math.min(100, Math.round((currentCount / LEVEL_CORE_TARGETS[current]) * 100)) : null;
  const target = next ? LEVEL_CORE_TARGETS[next] : null;
  const currentBarPercent = target && current ? Math.min(100, Math.round((currentCount / target) * 100)) : current ? 100 : 0;
  const nextBarPercent = target ? Math.min(100 - currentBarPercent, Math.round((nextCount / target) * 100)) : 0;

  const byType = {
    word: words.filter((card) => card.type === "word").length,
    phrase: cards.filter((card) => card.type === "phrase").length,
    sentence: cards.filter((card) => card.type === "sentence").length,
    expression: cards.filter((card) => card.type === "expression").length,
  };

  return {
    current,
    next,
    currentCount,
    nextCount,
    totalTagged,
    currentCorePercent,
    currentMasteryPercent,
    currentDisplay: current ? `${current}${currentMasteryPercent !== null && currentMasteryPercent >= 85 ? "+" : ""}` : "—",
    currentLabel: current ? LEVEL_LABELS[current] : "Уровень не размечен",
    nextLabel: next ? LEVEL_LABELS[next] : "следующая зона не определена",
    nextTarget: target,
    currentBarPercent,
    nextBarPercent,
    totalWords: words.length,
    byType,
  };
}

function getSkillStats(cards: Flashcard[], variantProgress: VariantProgressMap): SkillStat[] {
  return ALL_TRAIN_VARIANTS.map((variant) => {
    const progress = cards.map((card) => getVariantProgress(card, variant, variantProgress));
    const started = progress.filter((item) => item.repetitions > 0);
    const mastered = progress.filter((item) => item.intervalDays >= 15 && item.lapses === 0).length;
    const lapses = progress.reduce((sum, item) => sum + item.lapses, 0);
    return {
      variant,
      label: VARIANT_LABELS[variant],
      masteredPercent: cards.length > 0 ? Math.round((mastered / cards.length) * 1000) / 10 : null,
      averageInterval: started.length > 0 ? Math.round((started.reduce((sum, item) => sum + item.intervalDays, 0) / started.length) * 10) / 10 : 0,
      errorsPerCard: cards.length > 0 ? Math.round((lapses / cards.length) * 100) / 100 : 0,
    };
  });
}

function getDashboardStats(cards: Flashcard[], profile: UserProfile): DashboardStats {
  const variantProgress = getCardVariantProgressMap();
  const deck = computeDeckStats(cards, variantProgress);
  const words = uniqueWordCards(cards);
  const reviewedCards = cards.filter((card) => card.repetitions > 0 || card.lapses > 0);
  const errorFreeCards = reviewedCards.filter((card) => card.lapses === 0);
  const longTermCards = cards.filter((card) => card.intervalDays >= 15).length;
  const intervalBuckets: IntervalBucket[] = [
    { label: "0–3 дня", count: cards.filter((card) => card.intervalDays < 4).length, tone: "orange" },
    { label: "4–14 дней", count: cards.filter((card) => card.intervalDays >= 4 && card.intervalDays < 15).length, tone: "violet" },
    { label: "15–29 дней", count: cards.filter((card) => card.intervalDays >= 15 && card.intervalDays < 30).length, tone: "cyan" },
    { label: "30+ дней", count: cards.filter((card) => card.intervalDays >= 30).length, tone: "green" },
  ];

  return {
    deck,
    wordCount: words.length,
    srsCardCount: cards.length,
    reviewedCards: reviewedCards.length,
    errorFreeCards: errorFreeCards.length,
    accuracy: reviewedCards.length > 0 ? Math.round((errorFreeCards.length / reviewedCards.length) * 1000) / 10 : null,
    longTermCards,
    longTermPercent: cards.length > 0 ? Math.round((longTermCards / cards.length) * 1000) / 10 : null,
    completedLessons: Math.max(0, profile.booksFinished),
    startedLessons: Math.max(0, profile.booksStarted),
    intervalBuckets,
    skills: getSkillStats(cards, variantProgress),
    vocabulary: analyzeVocabulary(cards),
  };
}

export function HomeDashboard({ profile, cards, onOpenLiveChat, onOpenLiveTranslate }: Props) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const stats = useMemo(() => getDashboardStats(cards, profile), [cards, profile]);
  const languageName = LANGUAGE_NAMES[profile.targetLanguage] ?? profile.targetLanguage.toUpperCase();
  const languageCode = profile.targetLanguage.toUpperCase();
  const vocabulary = stats.vocabulary;

  useEffect(() => {
    if (!isDetailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDetailsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDetailsOpen]);

  return (
    <section className="screen home-screen stats-home-screen">
      <header className="home-header stats-home-header">
        <h1 className="home-title">AIBook</h1>
        <button className="icon-btn stats-home-call" onClick={onOpenLiveChat} type="button" aria-label="Голосовой звонок с AI" title="Голосовой звонок с AI">
          <Phone size={19} />
        </button>
      </header>

      <button className="live-translate-home-card" onClick={onOpenLiveTranslate} type="button">
        <span className="live-translate-home-icon"><Languages size={23} /></span>
        <span>
          <span className="action-card-label">Для реального разговора</span>
          <strong className="action-card-title">Live перевод</strong>
          <span className="action-card-sub">Слушайте русский перевод почти без задержки</span>
        </span>
        <ChevronRight size={20} className="action-card-arrow" />
      </button>

      <section className="stats-home-level" aria-labelledby="stats-home-level-title">
        <div className="stats-home-level-head">
          <div>
            <span className="stats-home-profile-pill">{languageCode} · {languageName}</span>
            <h2 id="stats-home-level-title">Аналитика прогресса и словарного запаса</h2>
            <p>Актуальные данные из базы: {number(stats.wordCount)} слов, {number(stats.srsCardCount)} карточек SRS</p>
          </div>
          <div className="stats-home-level-badge">
            <span>Текущий уровень</span>
            <strong>{vocabulary.currentDisplay}</strong>
            <em>{vocabulary.current && vocabulary.currentMasteryPercent !== null
              ? `${oneDecimal(vocabulary.currentMasteryPercent)} лексики ${vocabulary.current} закреплено`
              : "нет размеченных CEFR-данных"}</em>
          </div>
        </div>

        <div className="stats-home-level-rule" />
        <div className="stats-home-progress-labels">
          <span>{vocabulary.current ? `${vocabulary.current}: ${vocabulary.currentLabel} (${vocabulary.currentCorePercent}% ядра)` : "CEFR: нет данных"}</span>
          <span>{vocabulary.next ? `${vocabulary.next}: ${vocabulary.nextLabel} (~${vocabulary.nextCount} слов)` : "следующий уровень не определён"}</span>
          <span>{vocabulary.next ? `${LEVELS[LEVELS.indexOf(vocabulary.next) + 1] ?? "C2"}: следующий` : ""}</span>
        </div>
        <div className="stats-home-progress stats-home-progress-segments" aria-label="Распределение словаря по CEFR">
          <span className="stats-home-progress-current" style={{ width: `${vocabulary.currentBarPercent}%` }} />
          <span className="stats-home-progress-next" style={{ width: `${vocabulary.nextBarPercent}%` }} />
        </div>
        <div className="stats-home-progress-foot">
          <span>0 слов</span>
          <span>{vocabulary.current ? `${number(vocabulary.currentCount)} слов (${vocabulary.current})` : "CEFR не размечен"}</span>
          <span>{number(vocabulary.totalWords)} слов (текущее)</span>
          <span>{vocabulary.nextTarget ? `${number(vocabulary.nextTarget)}+ (Цель ${vocabulary.next})` : "—"}</span>
        </div>
      </section>

      <section className="stats-home-section" aria-labelledby="stats-home-metrics-title">
        <div className="stats-home-section-head">
          <div>
            <span className="stats-home-section-kicker">Сводка</span>
            <h2 id="stats-home-metrics-title">Главные показатели</h2>
          </div>
          <button className="stats-home-details-button" type="button" onClick={() => setIsDetailsOpen(true)}>
            Все показатели <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="stats-home-metrics">
          <MetricTile icon={<BookOpenCheck size={17} />} value={number(stats.wordCount)} label="Слов в базе" detail={`${number(stats.srsCardCount)} карточек с SRS`} tone="cyan" />
          <MetricTile icon={<Brain size={17} />} value={oneDecimal(stats.longTermPercent)} label="Долгосрочная память" detail="интервал ≥ 15 дней" tone="green" />
          <MetricTile icon={<Target size={17} />} value={oneDecimal(stats.accuracy)} label="Точность ответов" detail={`${number(stats.errorFreeCards)} карточек без единой ошибки`} tone="violet" />
          <MetricTile icon={<BarChart size={17} />} value={number(stats.completedLessons)} label="Пройдено уроков" detail={`из ${number(stats.startedLessons)} начатых (100% pass)`} tone="orange" />
        </div>
      </section>

      <p className="stats-home-footnote">
        <Clock3 size={14} /> CEFR считается по уровням, сохранённым у реальных слов; книги и общий размер колоды его не подменяют.
      </p>

      {isDetailsOpen && <AnalyticsModal stats={stats} languageName={languageName} onClose={() => setIsDetailsOpen(false)} />}
    </section>
  );
}

function MetricTile({ icon, value, label, detail, tone }: { icon: ReactNode; value: string; label: string; detail: string; tone: Tone }) {
  return (
    <article className={`stats-home-metric stats-home-metric-${tone}`}>
      <span className="stats-home-metric-icon">{icon}</span>
      <strong>{value}</strong>
      <span className="stats-home-metric-label">{label}</span>
      <span className="stats-home-metric-detail">{detail}</span>
    </article>
  );
}

function AnalyticsModal({ stats, languageName, onClose }: { stats: DashboardStats; languageName: string; onClose: () => void }) {
  const maxBucket = Math.max(1, ...stats.intervalBuckets.map((bucket) => bucket.count));
  const vocabulary = stats.vocabulary;

  return (
    <div className="stats-home-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="stats-home-modal" role="dialog" aria-modal="true" aria-labelledby="stats-modal-title">
        <header className="stats-home-modal-header">
          <div>
            <span className="stats-home-section-kicker">{languageName}</span>
            <h2 id="stats-modal-title">Полная аналитика</h2>
          </div>
          <button className="icon-btn stats-home-modal-close" type="button" onClick={onClose} aria-label="Закрыть аналитику">
            <X size={18} />
          </button>
        </header>

        <div className="stats-home-modal-level">
          <div>
            <span>Уровень сейчас</span>
            <strong>{vocabulary.currentDisplay}</strong>
          </div>
          <div className="stats-home-modal-level-copy">
            <span>{vocabulary.current ? `${oneDecimal(vocabulary.currentMasteryPercent)} лексики закреплено` : "CEFR-меток нет"}</span>
            <strong>{vocabulary.next ? `переход в ${vocabulary.next}` : "—"}</strong>
          </div>
          <div className="stats-home-progress stats-home-progress-segments">
            <span className="stats-home-progress-current" style={{ width: `${vocabulary.currentBarPercent}%` }} />
            <span className="stats-home-progress-next" style={{ width: `${vocabulary.nextBarPercent}%` }} />
          </div>
        </div>

        <div className="stats-home-detail-grid">
          <DetailStat label="Слов в базе" value={number(stats.wordCount)} />
          <DetailStat label="Долгосрочная память" value={oneDecimal(stats.longTermPercent)} />
          <DetailStat label="Точность ответов" value={oneDecimal(stats.accuracy)} />
          <DetailStat label="На повторение" value={number(stats.deck.dueCards)} />
        </div>

        <section className="stats-home-modal-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Интервалы SRS</span>
              <h3>Устойчивость памяти</h3>
            </div>
            <span>{number(stats.longTermCards)} карточек держатся 15+ дней</span>
          </div>
          <div className="stats-home-intervals">
            {stats.intervalBuckets.map((bucket) => (
              <div className="stats-home-interval-row" key={bucket.label}>
                <div className="stats-home-interval-meta"><span>{bucket.label}</span><strong>{number(bucket.count)}</strong></div>
                <div className="stats-home-interval-track"><span className={`stats-home-bar-${bucket.tone}`} style={{ width: `${bucket.count === 0 ? 0 : Math.max(5, (bucket.count / maxBucket) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-home-modal-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Развитие навыков (3 режима)</span>
              <h3>Мультимодальное обучение</h3>
            </div>
          </div>
          <div className="stats-home-skills">
            {stats.skills.map((skill) => (
              <div className="stats-home-skill" key={skill.variant}>
                <div><strong>{skill.label}</strong><span>{oneDecimal(skill.masteredPercent)} освоено</span></div>
                <div><span>Ср. интервал: {skill.averageInterval} дней</span><span>Ошибок на карточку: {skill.errorsPerCard}</span></div>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-home-modal-panel stats-home-reading-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Структура словаря</span>
              <h3>{number(vocabulary.totalWords)} материалов</h3>
            </div>
          </div>
          <div className="stats-home-reading-grid">
            <DetailStat label="Слова" value={number(vocabulary.byType.word)} />
            <DetailStat label="Фразы" value={number(vocabulary.byType.phrase)} />
            <DetailStat label="Предложения" value={number(vocabulary.byType.sentence)} />
            <DetailStat label="Выражения" value={number(vocabulary.byType.expression)} />
          </div>
          <p className="stats-home-modal-note">«Точность» здесь — доля просмотренных карточек без зарегистрированного lapse. Полного журнала всех ответов приложение не хранит.</p>
        </section>
      </section>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return <div className="stats-home-detail-stat"><span>{label}</span><strong>{value}</strong></div>;
}

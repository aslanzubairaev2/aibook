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
import type { CefrLevel, Flashcard, UserProfile } from "@/lib/types";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";

type Props = {
  profile: UserProfile;
  cards: Flashcard[];
  onOpenLiveChat: () => void;
  onOpenLiveTranslate: () => void;
};

type Tone = "cyan" | "green" | "violet" | "orange";

type DashboardStats = {
  totalWords: number;
  longTermWords: number;
  longTermPercent: number | null;
  accuracy: number | null;
  attempts: number;
  reviewedWords: number;
  dueWords: number;
  completedBooks: number;
  readingMinutes: number;
  intervalBuckets: Array<{ label: string; count: number; tone: Tone }>;
};

type LevelProgress = {
  current: CefrLevel;
  next: CefrLevel | null;
  percent: number;
  currentStart: number;
  nextTarget: number | null;
};

const LANGUAGE_NAMES: Record<string, string> = {
  de: "Немецкий язык",
  en: "Английский язык",
  es: "Испанский язык",
  fr: "Французский язык",
  it: "Итальянский язык",
};

const LEVEL_STEPS: Array<{ level: CefrLevel; start: number; target: number | null }> = [
  { level: "A1", start: 0, target: 80 },
  { level: "A2", start: 80, target: 250 },
  { level: "B1", start: 250, target: 600 },
  { level: "B2", start: 600, target: 1200 },
  { level: "C1", start: 1200, target: 2500 },
  { level: "C2", start: 2500, target: null },
];

function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function deriveLevelFromWords(wordCount: number): CefrLevel {
  return [...LEVEL_STEPS].reverse().find((step) => wordCount >= step.start)?.level ?? "A1";
}

function getLevelProgress(level: CefrLevel, wordCount: number): LevelProgress {
  const step = LEVEL_STEPS.find((item) => item.level === level) ?? LEVEL_STEPS[0];
  const nextStep = LEVEL_STEPS.find((item) => item.start === step.target);
  const span = step.target === null ? 1 : Math.max(1, step.target - step.start);
  const progress = step.target === null
    ? 100
    : Math.max(0, Math.min(100, Math.round(((wordCount - step.start) / span) * 100)));

  return {
    current: level,
    next: nextStep?.level ?? null,
    percent: progress,
    currentStart: step.start,
    nextTarget: step.target,
  };
}

function getDashboardStats(cards: Flashcard[], profile: UserProfile): DashboardStats {
  const totalWords = cards.length;
  const attempts = cards.reduce((sum, card) => sum + card.repetitions + card.lapses, 0);
  const correctReviews = cards.reduce((sum, card) => sum + card.repetitions, 0);
  const reviewedWords = cards.filter((card) => card.repetitions > 0 || card.lapses > 0).length;
  const longTermWords = cards.filter(
    (card) => card.intervalDays >= 15 || (card.status === "review" && card.repetitions >= 2),
  ).length;
  const now = Date.now();
  const dueWords = cards.filter((card) => {
    const dueAt = Date.parse(card.dueAt);
    return Number.isFinite(dueAt) && dueAt <= now;
  }).length;

  const intervalBuckets = [
    { label: "0–3 дня", count: cards.filter((card) => card.intervalDays < 4).length, tone: "orange" as Tone },
    { label: "4–14 дней", count: cards.filter((card) => card.intervalDays >= 4 && card.intervalDays < 15).length, tone: "violet" as Tone },
    { label: "15–29 дней", count: cards.filter((card) => card.intervalDays >= 15 && card.intervalDays < 30).length, tone: "cyan" as Tone },
    { label: "30+ дней", count: cards.filter((card) => card.intervalDays >= 30).length, tone: "green" as Tone },
  ];

  return {
    totalWords,
    longTermWords,
    longTermPercent: totalWords > 0 ? Math.round((longTermWords / totalWords) * 1000) / 10 : null,
    accuracy: attempts > 0 ? Math.round((correctReviews / attempts) * 1000) / 10 : null,
    attempts,
    reviewedWords,
    dueWords,
    completedBooks: Math.max(0, profile.booksFinished),
    readingMinutes: Math.max(0, profile.readingMinutes),
    intervalBuckets,
  };
}

export function HomeDashboard({ profile, cards, onOpenLiveChat, onOpenLiveTranslate }: Props) {
  const [estimatedLevel, setEstimatedLevel] = useState<CefrLevel | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const stats = useMemo(() => getDashboardStats(cards, profile), [cards, profile]);
  const fallbackLevel = deriveLevelFromWords(stats.totalWords);
  const currentLevel = estimatedLevel ?? fallbackLevel;
  const levelProgress = useMemo(
    () => getLevelProgress(currentLevel, stats.totalWords),
    [currentLevel, stats.totalWords],
  );

  useEffect(() => {
    let active = true;
    estimateTargetLanguageLevel(profile.targetLanguage)
      .then((estimate) => {
        if (active) setEstimatedLevel(estimate?.level ?? null);
      })
      .catch(() => {
        if (active) setEstimatedLevel(null);
      });

    return () => {
      active = false;
    };
  }, [profile.targetLanguage, stats.totalWords]);

  useEffect(() => {
    if (!isDetailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDetailsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDetailsOpen]);

  const languageName = LANGUAGE_NAMES[profile.targetLanguage] ?? profile.targetLanguage.toUpperCase();

  return (
    <section className="screen home-screen stats-home-screen">
      <header className="stats-home-header">
        <div>
          <span className="stats-home-kicker">AIBook · Личный прогресс</span>
          <h1 className="stats-home-title">Твоя статистика</h1>
          <p className="stats-home-subtitle">{languageName} · данные обновляются после каждой тренировки</p>
        </div>
        <button className="icon-btn stats-home-call" onClick={onOpenLiveChat} type="button" aria-label="Голосовой звонок с AI" title="Голосовой звонок с AI">
          <Phone size={19} />
        </button>
      </header>

      <button className="stats-home-live" onClick={onOpenLiveTranslate} type="button">
        <span className="stats-home-live-icon"><Languages size={23} /></span>
        <span className="stats-home-live-copy">
          <span className="stats-home-live-label">Для реального разговора</span>
          <strong>Live перевод</strong>
          <span>Слушайте перевод почти без задержки</span>
        </span>
        <ChevronRight size={20} className="stats-home-live-arrow" />
      </button>

      <section className="stats-home-level" aria-labelledby="stats-home-level-title">
        <div className="stats-home-level-head">
          <div>
            <span className="stats-home-profile-pill">{profile.targetLanguage.toUpperCase()} · {languageName}</span>
            <h2 id="stats-home-level-title">Аналитика прогресса и словарного запаса</h2>
            <p>Словарь и интервалы повторений · {number(stats.totalWords)} слов в базе</p>
          </div>
          <div className="stats-home-level-badge">
            <span>Текущий уровень</span>
            <strong>{currentLevel}<sup>+</sup></strong>
            <em>{levelProgress.next ? `→ переход в ${levelProgress.next}` : "верхняя граница шкалы"}</em>
          </div>
        </div>

        <div className="stats-home-level-rule" />
        <div className="stats-home-progress-labels">
          <span>{currentLevel}: текущая зона</span>
          <span>{levelProgress.next ? `${levelProgress.next}: следующий рубеж` : "C2: максимум"}</span>
        </div>
        <div className="stats-home-progress" aria-label={`Прогресс внутри уровня ${levelProgress.percent}%`}>
          <span style={{ width: `${Math.max(3, levelProgress.percent)}%` }} />
        </div>
        <div className="stats-home-progress-foot">
          <span>{number(levelProgress.currentStart)} слов</span>
          <span>{levelProgress.nextTarget ? `${number(levelProgress.nextTarget)} слов до ${levelProgress.next}` : "уровень C2"}</span>
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
          <MetricTile icon={<BookOpenCheck size={17} />} value={number(stats.totalWords)} label="Слов в базе" detail={`${number(stats.reviewedWords)} уже повторялись`} tone="cyan" />
          <MetricTile icon={<Brain size={17} />} value={percent(stats.longTermPercent)} label="Долгосрочная память" detail={`${number(stats.longTermWords)} слов · интервал 15+ дней`} tone="green" />
          <MetricTile icon={<Target size={17} />} value={percent(stats.accuracy)} label="Точность ответов" detail={stats.attempts > 0 ? `${number(stats.attempts)} ответов в SRS` : "Пока нет ответов в SRS"} tone="violet" />
          <MetricTile icon={<BarChart size={17} />} value={number(stats.completedBooks)} label="Завершено книг" detail={`${number(stats.readingMinutes)} мин. чтения`} tone="orange" />
        </div>
      </section>

      <p className="stats-home-footnote">
        <Clock3 size={14} /> Показатели считаются по локальным карточкам и синхронизированному профилю.
      </p>

      {isDetailsOpen && (
        <AnalyticsModal
          languageName={languageName}
          currentLevel={currentLevel}
          levelProgress={levelProgress}
          stats={stats}
          onClose={() => setIsDetailsOpen(false)}
        />
      )}
    </section>
  );
}

function MetricTile({
  icon,
  value,
  label,
  detail,
  tone,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  detail: string;
  tone: Tone;
}) {
  return (
    <article className={`stats-home-metric stats-home-metric-${tone}`}>
      <span className="stats-home-metric-icon">{icon}</span>
      <strong>{value}</strong>
      <span className="stats-home-metric-label">{label}</span>
      <span className="stats-home-metric-detail">{detail}</span>
    </article>
  );
}

function AnalyticsModal({
  languageName,
  currentLevel,
  levelProgress,
  stats,
  onClose,
}: {
  languageName: string;
  currentLevel: CefrLevel;
  levelProgress: LevelProgress;
  stats: DashboardStats;
  onClose: () => void;
}) {
  const maxBucket = Math.max(1, ...stats.intervalBuckets.map((bucket) => bucket.count));

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
            <strong>{currentLevel}<sup>+</sup></strong>
          </div>
          <div className="stats-home-modal-level-copy">
            <span>{levelProgress.next ? `До ${levelProgress.next} по словарю` : "Шкала завершена"}</span>
            <strong>{levelProgress.percent}%</strong>
          </div>
          <div className="stats-home-progress"><span style={{ width: `${Math.max(3, levelProgress.percent)}%` }} /></div>
        </div>

        <div className="stats-home-detail-grid">
          <DetailStat label="Слов в базе" value={number(stats.totalWords)} />
          <DetailStat label="Долгосрочная память" value={percent(stats.longTermPercent)} />
          <DetailStat label="Точность ответов" value={percent(stats.accuracy)} />
          <DetailStat label="На повторение" value={number(stats.dueWords)} />
        </div>

        <section className="stats-home-modal-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Интервалы SRS</span>
              <h3>Устойчивость памяти</h3>
            </div>
            <span>{number(stats.longTermWords)} слов держатся 15+ дней</span>
          </div>
          <div className="stats-home-intervals">
            {stats.intervalBuckets.map((bucket) => (
              <div className="stats-home-interval-row" key={bucket.label}>
                <div className="stats-home-interval-meta">
                  <span>{bucket.label}</span>
                  <strong>{number(bucket.count)}</strong>
                </div>
                <div className="stats-home-interval-track"><span className={`stats-home-bar-${bucket.tone}`} style={{ width: `${Math.max(bucket.count > 0 ? 5 : 0, (bucket.count / maxBucket) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-home-modal-panel stats-home-reading-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Обучение</span>
              <h3>Ритм занятий</h3>
            </div>
          </div>
          <div className="stats-home-reading-grid">
            <DetailStat label="Повторено слов" value={number(stats.reviewedWords)} />
            <DetailStat label="Ответов в SRS" value={number(stats.attempts)} />
            <DetailStat label="Завершено книг" value={number(stats.completedBooks)} />
            <DetailStat label="Минут чтения" value={number(stats.readingMinutes)} />
          </div>
        </section>
      </section>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-home-detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

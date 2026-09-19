"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenCheck,
  Brain,
  ChevronRight,
  Clock3,
  Languages,
  Phone,
  Repeat2,
  X,
} from "lucide-react";
import { computeDeckStats, type DeckStats } from "@/lib/cards";
import { getCardVariantProgressMap } from "@/lib/db/local";
import type { Flashcard, UserProfile } from "@/lib/types";

type Props = {
  profile: UserProfile;
  cards: Flashcard[];
  onOpenLiveChat: () => void;
  onOpenLiveTranslate: () => void;
};

type Tone = "cyan" | "green" | "violet" | "orange";
type IntervalBucket = { label: string; count: number; tone: Tone };

type DashboardStats = {
  deck: DeckStats;
  intervalBuckets: IntervalBucket[];
  maturePercent: number | null;
};

const LANGUAGE_NAMES: Record<string, string> = {
  de: "Немецкий язык",
  en: "Английский язык",
  es: "Испанский язык",
  fr: "Французский язык",
  it: "Итальянский язык",
};

function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function getDashboardStats(cards: Flashcard[]): DashboardStats {
  // This is the same aggregate used by the Practice screen and by the
  // research-agent get_progress tool: three independent SRS directions,
  // mature = 21+ days, due = the whole local day, hard = the SRS hard rule.
  const deck = computeDeckStats(cards, getCardVariantProgressMap());
  const intervalBuckets: IntervalBucket[] = [
    { label: "0–3 дня", count: cards.filter((card) => card.intervalDays < 4).length, tone: "orange" },
    { label: "4–14 дней", count: cards.filter((card) => card.intervalDays >= 4 && card.intervalDays < 15).length, tone: "violet" },
    { label: "15–29 дней", count: cards.filter((card) => card.intervalDays >= 15 && card.intervalDays < 30).length, tone: "cyan" },
    { label: "30+ дней", count: cards.filter((card) => card.intervalDays >= 30).length, tone: "green" },
  ];

  return {
    deck,
    intervalBuckets,
    maturePercent: cards.length > 0 ? Math.round((deck.matureCards / cards.length) * 1000) / 10 : null,
  };
}

export function HomeDashboard({ profile, cards, onOpenLiveChat, onOpenLiveTranslate }: Props) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const stats = useMemo(() => getDashboardStats(cards), [cards]);
  const languageName = LANGUAGE_NAMES[profile.targetLanguage] ?? profile.targetLanguage.toUpperCase();
  const languageCode = profile.targetLanguage.toUpperCase();

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
        <div>
          <h1 className="home-title">AIBook</h1>
        </div>
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
            <p>Карточки SRS · {number(stats.deck.totalCards)} в синхронизированной колоде</p>
          </div>
          <div className="stats-home-level-badge stats-home-level-unknown">
            <span>Текущий CEFR</span>
            <strong>—</strong>
            <em>нет диагностики</em>
          </div>
        </div>

        <div className="stats-home-level-rule" />
        <div className="stats-home-progress-labels">
          <span>Уровень не определён</span>
          <span>CEFR не выводится из числа карточек</span>
        </div>
        <div className="stats-home-progress stats-home-progress-empty" aria-label="Диагностика CEFR не выполнена">
          <span />
        </div>
        <div className="stats-home-progress-foot">
          <span>Нужна отдельная диагностика</span>
          <span>данные SRS ≠ тест уровня</span>
        </div>
      </section>

      <section className="stats-home-section" aria-labelledby="stats-home-metrics-title">
        <div className="stats-home-section-head">
          <div>
            <span className="stats-home-section-kicker">Сводка SRS</span>
            <h2 id="stats-home-metrics-title">Главные показатели</h2>
          </div>
          <button className="stats-home-details-button" type="button" onClick={() => setIsDetailsOpen(true)}>
            Все показатели <ArrowUpRight size={15} />
          </button>
        </div>

        <div className="stats-home-metrics">
          <MetricTile icon={<BookOpenCheck size={17} />} value={number(stats.deck.totalCards)} label="Карточки в SRS" detail="не уникальные слова" tone="cyan" />
          <MetricTile icon={<Brain size={17} />} value={number(stats.deck.matureCards)} label="Зрелые карточки" detail="интервал 21+ дней" tone="green" />
          <MetricTile icon={<Repeat2 size={17} />} value={number(stats.deck.dueCards)} label="На повторение" detail={`${number(stats.deck.dueReps)} заданий сегодня`} tone="violet" />
          <MetricTile icon={<AlertTriangle size={17} />} value={number(stats.deck.hardCards)} label="Сложные карточки" detail="забывания / низкая лёгкость" tone="orange" />
        </div>
      </section>

      <p className="stats-home-footnote">
        <Clock3 size={14} /> Счётчики совпадают с экраном «Практика» и не притворяются диагностикой уровня.
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
  const matureLabel = stats.maturePercent === null ? "—" : `${stats.maturePercent.toFixed(1)}%`;

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

        <div className="stats-home-modal-level stats-home-modal-level-unknown">
          <div>
            <span>Уровень CEFR</span>
            <strong>—</strong>
          </div>
          <div className="stats-home-modal-level-copy">
            <span>Что можно утверждать</span>
            <strong>только данные SRS</strong>
          </div>
          <p>Количество карточек, интервалы и ответы показывают состояние колоды, но не заменяют языковую диагностику.</p>
        </div>

        <div className="stats-home-detail-grid">
          <DetailStat label="Карточки в SRS" value={number(stats.deck.totalCards)} />
          <DetailStat label="Зрелые (21+ дней)" value={number(stats.deck.matureCards)} />
          <DetailStat label="Доля зрелых" value={matureLabel} />
          <DetailStat label="Сложные" value={number(stats.deck.hardCards)} />
        </div>

        <section className="stats-home-modal-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Интервалы SRS</span>
              <h3>Устойчивость памяти</h3>
            </div>
            <span>{number(stats.deck.matureCards)} карточек с интервалом 21+ дней</span>
          </div>
          <div className="stats-home-intervals">
            {stats.intervalBuckets.map((bucket) => (
              <div className="stats-home-interval-row" key={bucket.label}>
                <div className="stats-home-interval-meta">
                  <span>{bucket.label}</span>
                  <strong>{number(bucket.count)}</strong>
                </div>
                <div className="stats-home-interval-track"><span className={`stats-home-bar-${bucket.tone}`} style={{ width: `${bucket.count === 0 ? 0 : Math.max(5, (bucket.count / maxBucket) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-home-modal-panel stats-home-reading-panel">
          <div className="stats-home-panel-heading">
            <div>
              <span className="stats-home-section-kicker">Ритм занятий</span>
              <h3>Что происходит в колоде</h3>
            </div>
          </div>
          <div className="stats-home-reading-grid">
            <DetailStat label="Начаты карточки" value={number(stats.deck.learnedCards)} />
            <DetailStat label="Заданий сегодня" value={number(stats.deck.dueReps)} />
            <DetailStat label="Серия дней" value={number(stats.deck.streak)} />
            <DetailStat label="Забывания" value={number(stats.deck.lapses)} />
          </div>
          <p className="stats-home-modal-note">Точный retention/процент правильных ответов здесь не показывается: в текущем хранилище нет полного журнала попыток, а счётчик repetitions сбрасывается после забывания.</p>
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

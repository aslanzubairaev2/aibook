"use client";

// The pieces of the card screen that are not the trainer itself: labels and
// small helpers, the rows of the «Сегодня» and «Все карточки» lists, and the
// statistics panel. They were the first 450 lines of CardsView.tsx; nothing in
// them depends on its state.

import { useCallback, useMemo, memo } from "react";
import { Trash2, Calendar, MessageCircle, ShieldCheck } from "lucide-react";
import { type CardSkillState, type Flashcard, type LearningItemType, type TrainVariant, type TtsProvider } from "@/lib/types";
import { ALL_TRAIN_VARIANTS, deckInsight, CARD_STATUSES, type DeckStats, type TrainStatus } from "@/lib/cards";
import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { getAvailableTtsProviders, getTtsProviderLabel } from "@/lib/ttsProviders";
import { CardBackSummary } from "@/components/cards/CardBackSummary";
import { isPhrase, openFlashcardPreview } from "@/lib/wordMenu";
import { SkillBadges } from "@/components/cards/SkillBadges";

export function normalizeFront(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export const POS_SHORT: Record<string, string> = {
  "существительное": "сущ.", "глагол": "гл.", "прилагательное": "прил.",
  "наречие": "нар.", "предлог": "предл.", "союз": "союз",
  "местоимение": "мест.", "числительное": "числ.", "выражение": "выраж.",
};
export function shortPos(pos: string): string {
  return POS_SHORT[pos.trim().toLowerCase()] ?? "";
}

/**
 * For cards that predate the dictionary: German spelling gives away the two
 * cases worth marking. Anything less certain shows no chip at all rather than
 * a guess the learner would have to double-check.
 */
export function guessPos(front: string, back = ""): string {
  const text = front.trim();
  if (/^(der|die|das)\s+\S/i.test(text)) return "сущ.";
  // The back knows better than the ending: «trocken» ends like an infinitive
  // but its back lists degrees of comparison.
  if (/komparativ|superlativ/iu.test(back)) return "прил.";
  if (/мн\. ?ч\./iu.test(back)) return "сущ.";
  if (/^[a-zäöüß]+(en|ern|eln)$/i.test(text)) return "гл.";
  return "";
}

export type FilterStatus = "all" | "new" | "learning" | "review" | "relearning";
export type FilterType = "all" | LearningItemType;
export type SortOrder = "added" | "due" | "ease";

export const TYPE_LABELS: Record<LearningItemType, string> = {
  word: "Слово",
  phrase: "Фраза",
  sentence: "Предложение",
  expression: "Устойчивое выражение",
};

/** Expressions use the phrase analysis/chat mode; their deck type stays explicit. */
export function discussionModeForCard(type: LearningItemType): "word" | "phrase" | "sentence" {
  return type === "expression" ? "phrase" : type;
}

export const TRAIN_STATUS_LABELS: Record<Exclude<TrainStatus, "all">, string> = {
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
export const TRAIN_VARIANT_LABELS: Record<TrainVariant, string> = {
  forward: "Изучаемый → Родной",
  reverse: "Родной → Изучаемый",
  audio: "Аудио",
};

// The same three, short enough to sit in a row above the card. A pack is
// learned in this order — read it, then produce it, then take it by ear — and
// that order is the row's order.
export const VARIANT_SHORT_LABELS: Record<TrainVariant, string> = {
  forward: "Читаю",
  reverse: "Говорю",
  audio: "Слышу",
};
export const STATUS_COLORS: Record<string, string> = {
  new: "var(--accent)",
  learning: "var(--blue)",
  review: "var(--green)",
  relearning: "#e08888",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "Новые",
  learning: "Обучение",
  review: "Повторение",
  relearning: "Переучивание",
};

/** The three states in which the player is on screen — same test AudioScrubber makes. */
export function isPlayerShowing(status: string): boolean {
  return status === "playing" || status === "paused" || status === "loading";
}

export function cardNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "карточек";
  if (mod10 === 1) return "карточка";
  if (mod10 >= 2 && mod10 <= 4) return "карточки";
  return "карточек";
}

export function sourceNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "источников";
  if (mod10 === 1) return "источник";
  if (mod10 >= 2 && mod10 <= 4) return "источника";
  return "источников";
}

/** Offer only the voices that can actually speak the deck's language. */
export function ttsProvidersFor(lang: string): { value: TtsProvider; label: string }[] {
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
export type TokenizedTextProps = {
  text: string;
  style?: React.CSSProperties;
  onWordTap: (word: string, e: React.MouseEvent) => void;
  /** Target-language text: each word gets the right-click word menu. */
  menuWords?: boolean;
};

export const TokenizedText = memo(function TokenizedText({ text, style, onWordTap, menuWords }: TokenizedTextProps) {
  const tokens = useMemo(() => splitIntoTokens(text), [text]);
  return (
    <div style={style}>
      {tokens.map((tok, i) => {
        if (!normalizeToken(tok)) return <span key={i}>{tok}</span>;
        return (
          <span
            key={i}
            data-tap-word=""
            data-word={menuWords ? tok : undefined}
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
export function cardMarkers(card: Flashcard, facts: WordFacts | undefined): { text: string; kind: string }[] {
  const marks: { text: string; kind: string }[] = [
    { text: TYPE_LABELS[card.type], kind: card.type },
  ];
  const pos = card.type === "word" ? shortPos(facts?.pos ?? "") || guessPos(card.front, card.back) : "";
  if (pos) marks.push({ text: pos, kind: "pos" });
  const level = card.cefr || facts?.cefr || "";
  if (level) marks.push({ text: level, kind: "level" });
  return marks;
}

export type WordFacts = { pos: string; cefr: string };

/** One shared empty object, so a row without skill progress stays memo-stable. */
export const EMPTY_SKILL_STATE: CardSkillState = {};

export const DueCardRow = memo(function DueCardRow({ card, skillState }: { card: Flashcard; skillState: CardSkillState }) {
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

export type AllCardRowProps = {
  card: Flashcard;
  facts: WordFacts | undefined;
  targetLanguage: string;
  /** `card` is passed for words of the front, so their reading is fixed by the card. */
  onWordTap: (word: string, e: React.MouseEvent, card?: Flashcard | null) => void;
  onDiscuss: (card: Flashcard) => void;
  onFix: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  /** Forgotten LEECH_LAPSES+ times in some direction. */
  leech?: boolean;
};

export const AllCardRow = memo(function AllCardRow({ card, facts, targetLanguage, onWordTap, onDiscuss, onFix, onDelete, leech }: AllCardRowProps) {
  const color = STATUS_COLORS[card.status] ?? "var(--accent)";
  const tapFront = useCallback((word: string, e: React.MouseEvent) => onWordTap(word, e, card), [onWordTap, card]);
  // The row itself is the card: a word on it opens the word, a button does its
  // job, anywhere else shows the flashcard read-only.
  const openPreview = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("button, a, input, [data-tap-word]")) return;
    openFlashcardPreview(card.id);
  };
  // For the right-click menu: a one-word card is a word, anything longer a phrase.
  const menuAttrs = isPhrase(card.front)
    ? { "data-phrase": card.front, "data-phrase-card-id": card.id }
    : { "data-word": card.front, "data-card-id": card.id };
  return (
    <div className="flash-card all-card-row" onClick={openPreview} title="Открыть флешкарту" {...menuAttrs}>
      <div className="all-card-head">
        <div className="all-card-markers">
          {cardMarkers(card, facts).map((m, i) => (
            <span key={i} className={`card-marker ${m.kind}${i === 0 ? " lead" : ""}`}>{m.text}</span>
          ))}
          <span className="all-card-status" style={{ background: `${color}18`, color }}>
            {STATUS_LABELS[card.status] ?? card.status}
            {card.intervalDays > 0 ? ` · ${card.intervalDays}дн` : ""}
          </span>
          {leech && <span className="all-card-leech" title="Забыто 8+ раз">пиявка</span>}
        </div>
        <div className="all-card-actions">
          <button className="card-row-delete-btn" onClick={() => onDiscuss(card)} type="button" aria-label="Обсудить с AI" title="Обсудить с AI">
            <MessageCircle size={16} />
          </button>
          <button className="card-row-delete-btn" onClick={() => onFix(card)} type="button" aria-label="Проверить и исправить карточку" title="Проверить и исправить карточку">
            <ShieldCheck size={16} />
          </button>
          <button
            className="card-row-delete-btn danger"
            onClick={() => { if (confirm("Удалить карточку?")) onDelete(card.id); }}
            type="button"
            aria-label="Удалить"
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {/* Front is spoken and word-tappable, like text everywhere else in the app. */}
      <div className="flash-card-front all-card-front">
        <TokenizedText text={card.front} style={{ minWidth: 0 }} onWordTap={tapFront} menuWords />
        <SpeakButton text={card.front} lang={targetLanguage} size={15} />
      </div>
      <CardBackSummary
        front={card.front}
        back={card.back}
        renderText={(text) => <TokenizedText text={text} onWordTap={onWordTap} />}
      />
      <div className="flash-card-source">из «{card.sourceBookTitle || card.source}»</div>
    </div>
  );
});

export const VARIANT_LABELS_LONG: Record<TrainVariant, string> = {
  forward: "Узнавание",
  reverse: "Воспроизведение",
  audio: "Аудирование",
};

export const VARIANT_COLORS: Record<TrainVariant, string> = {
  forward: "var(--blue)",
  reverse: "var(--accent)",
  audio: "var(--green)",
};

export const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** A labelled progress row — the shape every block in the panel is built from. */
export function StatBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
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
export const StatsPanel = memo(function StatsPanel({ stats, onClick }: { stats: DeckStats; onClick: (e: React.MouseEvent) => void }) {
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

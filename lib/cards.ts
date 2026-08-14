import type { CardFilters, CardVariantState, Flashcard, SkillProgress, TrainVariant } from "@/lib/types";

export const ALL_TRAIN_VARIANTS: TrainVariant[] = ["forward", "reverse", "audio"];

export type CardStatus = Flashcard["status"];
export type TrainStatus = CardStatus | "all" | "hard";
export type CardType = Flashcard["type"];
export type TrainTypeFilter = CardType | "all";
export type VariantProgressMap = Record<string, CardVariantState>;
export type TrainQueueItem = { card: Flashcard; variant: TrainVariant };

/** The SM-2 fields a single prompt direction schedules on. */
export type VariantProgress = {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
};

export const CARD_STATUSES: CardStatus[] = ["new", "learning", "review", "relearning"];

export type ReviewHistoryPosition = {
  index: number;
  canGoOlder: boolean;
  canGoNewer: boolean;
};

/** Resolves a safe, read-only position inside the current session's review history. */
export function getReviewHistoryPosition(
  historyLength: number,
  requestedIndex: number | null,
): ReviewHistoryPosition | null {
  if (historyLength <= 0 || requestedIndex === null) return null;
  const index = Math.min(Math.max(requestedIndex, 0), historyLength - 1);
  return {
    index,
    canGoOlder: index > 0,
    canGoNewer: index < historyLength - 1,
  };
}

/** Dictionary grammar follows the native meaning on a separate line. */
export function splitCardBack(back: string): { meaning: string; details: string } {
  const [meaning = "", ...detailLines] = back.replace(/\r\n/g, "\n").split("\n");
  return { meaning: meaning.trim(), details: detailLines.join("\n").trim() };
}

function reviewedAt(progress: SkillProgress): number {
  const value = progress.lastReviewedAt ? Date.parse(progress.lastReviewedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function newerProgress(local?: SkillProgress, remote?: SkillProgress): SkillProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  const localTime = reviewedAt(local);
  const remoteTime = reviewedAt(remote);
  if (localTime !== remoteTime) return localTime > remoteTime ? local : remote;
  if (local.repetitions !== remote.repetitions) return local.repetitions > remote.repetitions ? local : remote;
  return remote;
}

/** Keeps offline reviews while accepting newer progress loaded from Supabase. */
export function mergeCardVariantProgress(
  local: Record<string, CardVariantState>,
  remote: Record<string, CardVariantState>,
): Record<string, CardVariantState> {
  const merged: Record<string, CardVariantState> = {};
  for (const cardId of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const reverse = newerProgress(local[cardId]?.reverse, remote[cardId]?.reverse);
    const audio = newerProgress(local[cardId]?.audio, remote[cardId]?.audio);
    if (reverse || audio) merged[cardId] = { reverse, audio };
  }
  return merged;
}

/** Normalizes card text for duplicate comparison: trims, collapses whitespace, lowercases. */
export function normalizeCardText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Finds an existing card with the same front text (case/whitespace-insensitive). */
export function findDuplicateCard(front: string, cards: Flashcard[]): Flashcard | null {
  const norm = normalizeCardText(front);
  if (!norm) return null;
  return cards.find((c) => normalizeCardText(c.front) === norm) ?? null;
}

/** Keeps a dictionary batch distinct even when another batch has the same title. */
export function filterCardsByTrainingSource(
  cards: Flashcard[],
  sourceTitle: string,
  sourceId: string | null,
): Flashcard[] {
  if (sourceId) return cards.filter((card) => card.sourceBookId === sourceId);
  if (sourceTitle === "all") return cards;
  return cards.filter((card) => (card.sourceBookTitle || card.source || "") === sourceTitle);
}

export const DEFAULT_TRAIN_VARIANTS: TrainVariant[] = ["forward"];

/** A dictionary batch being trained right now — session state, never persisted. */
export type TrainBatch = { id: string; title: string };

export type ResolvedCardFilters = {
  filterStatus: CardStatus | "all";
  filterType: TrainTypeFilter;
  filterBook: string;
  filterLevel: string;
  sortOrder: NonNullable<CardFilters["sortOrder"]>;
  trainFilter: TrainTypeFilter;
  trainStatus: TrainStatus;
  trainBook: string;
  trainSourceId: string | null;
  trainVariants: TrainVariant[];
  trainMode: NonNullable<CardFilters["trainMode"]>;
};

/**
 * The filters a screen actually runs with.
 *
 * Two layers, deliberately kept apart. `saved` is the learner's own
 * configuration — the one they set up in the card module and expect to find
 * again next time. `batch` is «тренировать эту пачку»: it narrows to one
 * photographed page and clears whatever narrowing was left over, because a
 * stale type or status would quietly hide most of the batch.
 *
 * The batch layer is applied here rather than written into `saved`, which is
 * what it used to do. Overwriting meant the batch's own "all types, all
 * statuses, every direction" became the learner's configuration permanently,
 * and the deck stayed pinned to that one page long after it was finished —
 * «Начать тренировку» would keep serving it forever. Ending a batch is now
 * just calling this again without one.
 */
export function resolveCardFilters(
  saved: CardFilters | undefined,
  batch: TrainBatch | null = null,
): ResolvedCardFilters {
  const sortOrder = saved?.sortOrder ?? "added";

  if (batch) {
    return {
      filterStatus: "all",
      filterType: "all",
      filterBook: batch.title,
      filterLevel: "all",
      sortOrder,
      trainFilter: "all",
      trainStatus: "all",
      trainBook: batch.title,
      trainSourceId: batch.id,
      // Titles repeat — every page photographed on the same day can share one —
      // so the id above is the real filter, and the title is only what the
      // learner sees.
      trainVariants: [...ALL_TRAIN_VARIANTS],
      trainMode: "recognize",
    };
  }

  return {
    filterStatus: saved?.filterStatus ?? "all",
    filterType: saved?.filterType ?? "all",
    filterBook: saved?.filterBook ?? "all",
    filterLevel: saved?.filterLevel ?? "all",
    sortOrder,
    trainFilter: saved?.trainFilter ?? "all",
    trainStatus: saved?.trainStatus ?? "all",
    trainBook: saved?.trainBook ?? "all",
    trainSourceId: saved?.trainSourceId ?? null,
    trainVariants: saved?.trainVariants?.length ? saved.trainVariants : DEFAULT_TRAIN_VARIANTS,
    trainMode: saved?.trainMode ?? "recognize",
  };
}

// ─── Training queue ─────────────────────────────────────────────────────────
//
// These are pure on purpose. They used to live inside the CardsView render body
// and reach into localStorage per card per variant, which meant a 500-card deck
// re-parsed the whole progress store thousands of times for every keystroke.
// The caller now reads the progress map once and passes it in.

const UNSEEN_VARIANT: VariantProgress = {
  status: "new",
  repetitions: 0,
  lapses: 0,
  intervalDays: 0,
  easeFactor: 2.5,
  // A never-scheduled variant is due immediately; "new" already says so, and
  // the epoch keeps every date comparison honest without allocating a Date.
  dueAt: "1970-01-01T00:00:00.000Z",
};

/**
 * The base Flashcard SM-2 fields are the "forward" variant's progress;
 * "reverse"/"audio" keep their own independent schedule in the variant map.
 */
export function getVariantProgress(
  card: Flashcard,
  variant: TrainVariant,
  variantProgress: VariantProgressMap,
): VariantProgress {
  if (variant === "forward") return card;
  return variantProgress[card.id]?.[variant] ?? UNSEEN_VARIANT;
}

/**
 * "Hard": repeatedly forgotten, or ground down to a low ease factor — the ones
 * the learner keeps losing. Trainable regardless of the due date.
 */
export function isHardProgress(p: { lapses: number; repetitions: number; easeFactor: number }): boolean {
  return p.lapses >= 2 || (p.repetitions > 0 && p.easeFactor <= 2.2);
}

export function isVariantDue(p: VariantProgress, todayEndMs: number): boolean {
  return p.status === "new" || Date.parse(p.dueAt) <= todayEndMs;
}

export type TrainSelection = {
  status: TrainStatus;
  type: TrainTypeFilter;
  variants: TrainVariant[];
  book?: string;
  sourceId?: string | null;
};

function matchesTrainStatus(p: VariantProgress, selection: TrainStatus, due: boolean): boolean {
  if (selection === "hard") return isHardProgress(p);
  if (!due) return false;
  return selection === "all" || p.status === selection;
}

/** The cards a session will actually walk through, one item per due variant. */
export function buildTrainQueue(
  cards: Flashcard[],
  selection: TrainSelection,
  variantProgress: VariantProgressMap,
  todayEndMs: number,
): TrainQueueItem[] {
  const typed = selection.type === "all" ? cards : cards.filter((c) => c.type === selection.type);
  const scoped = filterCardsByTrainingSource(typed, selection.book ?? "all", selection.sourceId ?? null);

  const items: TrainQueueItem[] = [];
  for (const card of scoped) {
    for (const variant of selection.variants) {
      const p = getVariantProgress(card, variant, variantProgress);
      if (matchesTrainStatus(p, selection.status, isVariantDue(p, todayEndMs))) {
        items.push({ card, variant });
      }
    }
  }
  return items;
}

/** Interleaves the variants so a session isn't all of one before the next. */
export function shuffleTrainQueue(items: TrainQueueItem[]): TrainQueueItem[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export type TrainCounts = {
  /** How many items each status chip would train, under the current type filter. */
  byStatus: Record<TrainStatus, number>;
  /** How many items each type chip would train, under the current status filter. */
  byType: Record<TrainTypeFilter, number>;
};

/**
 * Every filter-chip count in one pass over the deck.
 *
 * Each chip used to build its own queue on every render — seven full traversals
 * of the deck per keystroke — which is what made changing a filter take half a
 * minute.
 */
export function countTrainCandidates(
  cards: Flashcard[],
  selection: TrainSelection,
  variantProgress: VariantProgressMap,
  todayEndMs: number,
): TrainCounts {
  const counts: TrainCounts = {
    byStatus: { all: 0, new: 0, learning: 0, review: 0, relearning: 0, hard: 0 },
    byType: { all: 0, word: 0, phrase: 0, sentence: 0 },
  };
  const scoped = filterCardsByTrainingSource(cards, selection.book ?? "all", selection.sourceId ?? null);

  for (const card of scoped) {
    const typeMatches = selection.type === "all" || card.type === selection.type;
    for (const variant of selection.variants) {
      const p = getVariantProgress(card, variant, variantProgress);
      const due = isVariantDue(p, todayEndMs);

      if (typeMatches) {
        if (isHardProgress(p)) counts.byStatus.hard += 1;
        if (due) {
          counts.byStatus.all += 1;
          counts.byStatus[p.status] += 1;
        }
      }
      if (matchesTrainStatus(p, selection.status, due)) {
        counts.byType.all += 1;
        counts.byType[card.type] += 1;
      }
    }
  }
  return counts;
}

// ─── Deck statistics ────────────────────────────────────────────────────────

export type DeckSourceStat = {
  key: string;
  title: string;
  cards: number;
  due: number;
  learned: number;
  mature: number;
};

export type DeckStats = {
  totalCards: number;
  byStatus: Record<CardStatus, number>;
  /** Distinct cards with at least one variant due today. */
  dueCards: number;
  /** Individual repetitions waiting today — what a full session actually costs. */
  dueReps: number;
  dueByVariant: Record<TrainVariant, number>;
  learnedCards: number;
  matureCards: number;
  learnedVariants: number;
  totalVariants: number;
  /** Cards met at least once in each direction — where the real gaps show. */
  startedByVariant: Record<TrainVariant, number>;
  hardCards: number;
  /**
   * Times a prompt has been forgotten, summed over the deck. There is no review
   * log to compute a true retention rate from — `repetitions` resets on a lapse
   * — so this is reported as the raw count it actually is.
   */
  lapses: number;
  streak: number;
  bestStreak: number;
  reviewedToday: number;
  forecast: { dayOffset: number; count: number }[];
  sources: DeckSourceStat[];
};

/** Anki's convention: an interval past three weeks counts as settled. */
const MATURE_INTERVAL_DAYS = 21;
const FORECAST_DAYS = 7;

function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function streaksFromDays(days: Set<string>, today: Date): { streak: number; best: number } {
  if (days.size === 0) return { streak: 0, best: 0 };

  const cursor = new Date(today);
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  // Yesterday still counts as an unbroken streak until today is over.
  if (!days.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(keyOf(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sorted = [...days]
    .map((key) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  const dayMs = 24 * 60 * 60 * 1000;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    // Comparing calendar days, so DST shifts make the gap 23h or 25h.
    const gapDays = Math.round((sorted[i] - sorted[i - 1]) / dayMs);
    run = gapDays === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  return { streak, best: Math.max(best, streak) };
}

/**
 * Everything the statistics panel shows, from one traversal of the deck.
 *
 * Counts are per prompt direction wherever a session would be: a card the
 * learner has met forward but never in reverse is genuinely half-learned, and
 * a "due today" number that ignores two thirds of the queue is the reason the
 * old banner never matched the trainer's own progress line.
 */
export function computeDeckStats(
  cards: Flashcard[],
  variantProgress: VariantProgressMap,
  now: Date = new Date(),
): DeckStats {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndMs = todayEnd.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const stats: DeckStats = {
    totalCards: cards.length,
    byStatus: { new: 0, learning: 0, review: 0, relearning: 0 },
    dueCards: 0,
    dueReps: 0,
    dueByVariant: { forward: 0, reverse: 0, audio: 0 },
    learnedCards: 0,
    matureCards: 0,
    learnedVariants: 0,
    totalVariants: cards.length * ALL_TRAIN_VARIANTS.length,
    startedByVariant: { forward: 0, reverse: 0, audio: 0 },
    hardCards: 0,
    lapses: 0,
    streak: 0,
    bestStreak: 0,
    reviewedToday: 0,
    forecast: Array.from({ length: FORECAST_DAYS }, (_, dayOffset) => ({ dayOffset: dayOffset + 1, count: 0 })),
    sources: [],
  };

  const reviewDays = new Set<string>();
  const todayKey = dayKey(now.toISOString());
  const sources = new Map<string, DeckSourceStat>();

  for (const card of cards) {
    stats.byStatus[card.status] = (stats.byStatus[card.status] ?? 0) + 1;

    const sourceKey = card.sourceBookId || card.sourceBookTitle || card.source || "";
    const source = sources.get(sourceKey) ?? {
      key: sourceKey,
      title: card.sourceBookTitle || card.source || "Без источника",
      cards: 0,
      due: 0,
      learned: 0,
      mature: 0,
    };
    source.cards += 1;

    let cardDue = false;
    let cardTouched = false;
    let cardHard = false;

    for (const variant of ALL_TRAIN_VARIANTS) {
      const p = getVariantProgress(card, variant, variantProgress);
      stats.lapses += p.lapses;
      if (isHardProgress(p)) cardHard = true;
      if (p.repetitions > 0) {
        stats.learnedVariants += 1;
        stats.startedByVariant[variant] += 1;
        cardTouched = true;
      }
      if (isVariantDue(p, todayEndMs)) {
        cardDue = true;
        stats.dueReps += 1;
        stats.dueByVariant[variant] += 1;
      } else {
        const inDays = Math.ceil((Date.parse(p.dueAt) - todayEndMs) / dayMs);
        if (inDays >= 1 && inDays <= FORECAST_DAYS) stats.forecast[inDays - 1].count += 1;
      }

      const reviewedOn = dayKey(
        variant === "forward" ? card.lastReviewedAt : variantProgress[card.id]?.[variant]?.lastReviewedAt,
      );
      if (reviewedOn) {
        reviewDays.add(reviewedOn);
        if (reviewedOn === todayKey) stats.reviewedToday += 1;
      }
    }

    if (cardDue) {
      stats.dueCards += 1;
      source.due += 1;
    }
    if (cardTouched) {
      stats.learnedCards += 1;
      source.learned += 1;
    }
    if (card.intervalDays >= MATURE_INTERVAL_DAYS) {
      stats.matureCards += 1;
      source.mature += 1;
    }
    if (cardHard) stats.hardCards += 1;

    sources.set(sourceKey, source);
  }

  const { streak, best } = streaksFromDays(reviewDays, now);
  stats.streak = streak;
  stats.bestStreak = best;
  stats.sources = [...sources.values()].sort((a, b) => b.due - a.due || b.cards - a.cards);

  return stats;
}

export const VARIANT_NAMES: Record<TrainVariant, string> = {
  forward: "узнавание",
  reverse: "воспроизведение",
  audio: "аудирование",
};

const WEEKDAY_NAMES = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];

/**
 * One sentence saying what the numbers add up to.
 *
 * A wall of counters tells a learner what is true but not what to do about it,
 * so this names the direction that is furthest behind — the one worth spending
 * the next sessions on — and warns about the heaviest day ahead, which is the
 * other decision the forecast supports.
 */
export function deckInsight(stats: DeckStats, now: Date = new Date()): string | null {
  if (stats.totalCards === 0) return null;

  const parts: string[] = [];

  const behind = [...ALL_TRAIN_VARIANTS].sort(
    (a, b) => stats.startedByVariant[a] - stats.startedByVariant[b],
  );
  const weakest = behind[0];
  const strongest = behind[behind.length - 1];
  // Only worth naming when the gap is real rather than a rounding difference.
  if (stats.startedByVariant[strongest] - stats.startedByVariant[weakest] >= Math.max(5, stats.totalCards * 0.05)) {
    parts.push(`Главный резерв — ${VARIANT_NAMES[weakest]}: начато ${stats.startedByVariant[weakest]} из ${stats.totalCards}`);
  }

  const peak = stats.forecast.reduce((best, day) => (day.count > best.count ? day : best), stats.forecast[0]);
  if (peak && peak.count > 0) {
    const date = new Date(now);
    date.setDate(date.getDate() + peak.dayOffset);
    parts.push(`самый нагруженный день впереди — ${WEEKDAY_NAMES[date.getDay()]}, ${peak.count} повторений`);
  }

  if (parts.length === 0) {
    return stats.dueReps > 0
      ? `Сегодня осталось ${stats.dueReps} повторений.`
      : "На сегодня всё повторено.";
  }
  return `${parts.join("; ")}.`;
}

/** Counts each prompt direction as an independent learned item. */
export function getCardsVariantProgress(
  cards: Flashcard[],
  variantProgress: Record<string, CardVariantState>,
): { learned: number; total: number } {
  let learned = 0;
  for (const card of cards) {
    if (card.repetitions > 0) learned += 1;
    const state = variantProgress[card.id];
    if ((state?.reverse?.repetitions ?? 0) > 0) learned += 1;
    if ((state?.audio?.repetitions ?? 0) > 0) learned += 1;
  }
  return { learned, total: cards.length * ALL_TRAIN_VARIANTS.length };
}

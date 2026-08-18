import type { CardFilters, CardVariantState, Flashcard, PackSort, PackTraining, SkillProgress, TrainVariant } from "@/lib/types";

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

/**
 * What identifies the place a card came from.
 *
 * The pack's id where there is one — two packs photographed on the same day
 * genuinely share a title — and the title itself for everything older, which
 * is the only handle those cards have.
 */
export function cardSourceKey(card: Flashcard): string {
  return card.sourceBookId || card.sourceBookTitle || card.source || "";
}

/** One entry per place the deck's cards come from, biggest first. */
export type CardSource = { key: string; title: string; cards: number };

export function listCardSources(cards: Flashcard[]): CardSource[] {
  const sources = new Map<string, CardSource>();
  for (const card of cards) {
    const key = cardSourceKey(card);
    if (!key) continue;
    const found = sources.get(key);
    if (found) found.cards += 1;
    else sources.set(key, { key, title: card.sourceBookTitle || card.source || "Без источника", cards: 1 });
  }
  return [...sources.values()].sort((a, b) => b.cards - a.cards || a.title.localeCompare(b.title, "ru"));
}

/**
 * Narrows the deck to what a session is allowed to draw from.
 *
 * Two opposite ways of saying it, and both are needed. Picking one source is
 * how a single pack gets drilled; `excluded` is how the rest of the deck gets
 * trained *without* something — the book that is finished, the pack the
 * learner is deliberately leaving for later. Saying that as a positive
 * selection would mean naming every source they do want, and re-naming them
 * every time a new one arrives.
 */
export function filterCardsByTrainingSource(
  cards: Flashcard[],
  sourceTitle: string,
  sourceId: string | null,
  excluded: string[] = [],
): Flashcard[] {
  const scoped = sourceId
    ? cards.filter((card) => card.sourceBookId === sourceId)
    : sourceTitle === "all"
      ? cards
      : cards.filter((card) => (card.sourceBookTitle || card.source || "") === sourceTitle);

  if (excluded.length === 0) return scoped;
  // A source picked by hand outranks the exclusion list: asking for exactly
  // this pack and being given nothing would be the filter arguing with the
  // learner rather than obeying them.
  if (sourceId || sourceTitle !== "all") return scoped;

  const blocked = new Set(excluded);
  return scoped.filter((card) => !blocked.has(cardSourceKey(card)));
}

export const DEFAULT_TRAIN_VARIANTS: TrainVariant[] = ["forward"];

/**
 * A pack being trained right now — session state, never persisted.
 *
 * `id` is empty for a pack that exists only as a group of cards sharing a
 * source (anything an assistant added with add_flashcards before packs could
 * hold them); those are matched by title instead.
 */
export type TrainBatch = { id: string; title: string; training?: PackTraining | null };

const TRAIN_TYPES: NonNullable<PackTraining["type"]>[] = ["all", "word", "phrase", "sentence"];
const TRAIN_STATUSES: NonNullable<PackTraining["status"]>[] =
  ["all", "new", "learning", "review", "relearning", "hard"];

/**
 * A pack's stored preferences, cleaned of whatever an outside agent may have
 * put there. Anything unrecognised is dropped rather than trusted: these values
 * drive the trainer, and a bad one would silently empty the queue.
 */
export function normalizePackTraining(raw: unknown): PackTraining | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const out: PackTraining = {};

  const variants = Array.isArray(source.variants)
    ? ALL_TRAIN_VARIANTS.filter((v) => (source.variants as unknown[]).includes(v))
    : [];
  if (variants.length > 0) out.variants = variants;

  const type = String(source.type ?? "");
  if (TRAIN_TYPES.includes(type as NonNullable<PackTraining["type"]>)) {
    out.type = type as NonNullable<PackTraining["type"]>;
  }

  const status = String(source.status ?? "");
  if (TRAIN_STATUSES.includes(status as NonNullable<PackTraining["status"]>)) {
    out.status = status as NonNullable<PackTraining["status"]>;
  }

  if (source.mode === "recognize" || source.mode === "active") out.mode = source.mode;

  const note = typeof source.note === "string" ? source.note.trim().slice(0, 200) : "";
  if (note) out.note = note;

  return Object.keys(out).length > 0 ? out : null;
}

// ─── The order the packs are shown in ───────────────────────────────────────

/** What ordering the packs by; enough of a pack for any of them to be decided. */
export type SortablePack = {
  title: string;
  /** Milliseconds since the epoch; 0 for a pack whose date is unknown. */
  createdAt: number;
  /** How much of the pack is learned, 0–100. */
  percent: number;
};

export const PACK_SORT_LABELS: Record<PackSort, string> = {
  new: "Новые",
  unlearned: "Неизученные",
  progress: "По прогрессу",
  title: "По названию",
};

/**
 * Newest first is the default, and it is not arbitrary: the pack the learner
 * just built — photographed, or added by their assistant — is the one they
 * opened the screen for. It used to be appended below everything else, which
 * is exactly the complaint that «пачка не на самом верху».
 *
 * The others answer the two questions asked of a list of packs: what have I
 * not done yet, and what am I nearly finished with. Ties fall back to newest,
 * so an untouched shelf still reads newest-first.
 */
export function comparePacks(sort: PackSort): (a: SortablePack, b: SortablePack) => number {
  const newestFirst = (a: SortablePack, b: SortablePack) => b.createdAt - a.createdAt;

  switch (sort) {
    case "unlearned":
      return (a, b) => a.percent - b.percent || newestFirst(a, b);
    case "progress":
      return (a, b) => b.percent - a.percent || newestFirst(a, b);
    case "title":
      return (a, b) => a.title.localeCompare(b.title, "ru") || newestFirst(a, b);
    default:
      return newestFirst;
  }
}

/** «Родной → Изучаемый · Аудио · только предложения» — what a pack's own setup does, in one line. */
export function describePackTraining(training: PackTraining | null | undefined): string {
  const t = normalizePackTraining(training);
  if (!t) return "";
  const parts: string[] = [];
  if (t.variants?.length) parts.push(t.variants.map((v) => PACK_VARIANT_LABELS[v]).join(" · "));
  if (t.mode === "active") parts.push("активная тренировка");
  if (t.type && t.type !== "all") parts.push(PACK_TYPE_LABELS[t.type]);
  if (t.status && t.status !== "all") parts.push(PACK_STATUS_LABELS[t.status]);
  return parts.join(" · ");
}

const PACK_VARIANT_LABELS: Record<TrainVariant, string> = {
  forward: "Изучаемый → Родной",
  reverse: "Родной → Изучаемый",
  audio: "Аудио",
};

const PACK_TYPE_LABELS: Record<string, string> = {
  word: "только слова",
  phrase: "только фразы",
  sentence: "только предложения",
};

const PACK_STATUS_LABELS: Record<string, string> = {
  new: "только новые",
  learning: "только на изучении",
  review: "только на повторении",
  relearning: "только переучиваемые",
  hard: "только сложные",
};

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
  trainExcluded: string[];
  trainVariants: TrainVariant[];
  trainMode: NonNullable<CardFilters["trainMode"]>;
  zenMode: boolean;
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
    // A pack may carry its own answer to "how should this one be drilled" —
    // a set of phrases to be produced from Russian is not a page of nouns to be
    // recognised. Where it says nothing, the batch default below applies:
    // everything in the pack, in every direction.
    const training = normalizePackTraining(batch.training);
    return {
      filterStatus: "all",
      filterType: "all",
      filterBook: batch.title,
      filterLevel: "all",
      sortOrder,
      trainFilter: training?.type ?? "all",
      trainStatus: training?.status ?? "all",
      trainBook: batch.title,
      // Titles repeat — every page photographed on the same day can share one —
      // so the id below is the real filter where there is one, and the title is
      // what the learner sees. A pack that is only a group of cards sharing a
      // source has no id, and is matched by that title alone.
      trainSourceId: batch.id || null,
      // «Тренировать эту пачку» means this pack, whatever the learner has
      // otherwise told the trainer to skip — including, quite possibly, this.
      trainExcluded: [],
      trainVariants: training?.variants?.length ? [...training.variants] : [...ALL_TRAIN_VARIANTS],
      trainMode: training?.mode ?? "recognize",
      // Zen is how the learner likes to train, not part of what is being
      // trained, so a batch narrows the deck without changing the view.
      zenMode: saved?.zenMode ?? false,
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
    trainExcluded: saved?.trainExcluded ?? [],
    trainVariants: saved?.trainVariants?.length ? saved.trainVariants : DEFAULT_TRAIN_VARIANTS,
    trainMode: saved?.trainMode ?? "recognize",
    zenMode: saved?.zenMode ?? false,
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
  /** Source keys this session leaves alone — see filterCardsByTrainingSource. */
  excluded?: string[];
  /**
   * Drill: take everything in scope, whether or not it is due.
   *
   * A pack that has just been photographed is not on a schedule yet — it is
   * being met for the first time, and the learner wants to go through it again,
   * and again, until the words start to stick. The schedule is what governs
   * *when a card comes back on its own*; it should not be what stops someone
   * from deliberately opening the same pack twice in one evening. That was the
   * whole of «тренировать пачку заново → нет карточек по выбранным фильтрам»:
   * every card had just been graded, so nothing was due, so the queue was empty.
   *
   * Grading still schedules normally — this only decides who gets into the
   * queue, never what a grade does to them.
   */
  ignoreSchedule?: boolean;
};

function matchesTrainStatus(
  p: VariantProgress,
  selection: TrainStatus,
  due: boolean,
  ignoreSchedule = false,
): boolean {
  if (selection === "hard") return isHardProgress(p);
  if (!due && !ignoreSchedule) return false;
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
  const scoped = filterCardsByTrainingSource(typed, selection.book ?? "all", selection.sourceId ?? null, selection.excluded);

  const items: TrainQueueItem[] = [];
  for (const card of scoped) {
    for (const variant of selection.variants) {
      const p = getVariantProgress(card, variant, variantProgress);
      if (matchesTrainStatus(p, selection.status, isVariantDue(p, todayEndMs), selection.ignoreSchedule)) {
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
  const scoped = filterCardsByTrainingSource(cards, selection.book ?? "all", selection.sourceId ?? null, selection.excluded);

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
      if (matchesTrainStatus(p, selection.status, due, selection.ignoreSchedule)) {
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
  /**
   * The part of today's queue that was actually scheduled for an earlier day.
   * Half a session left undone on Saturday reappears silently inside Sunday's
   * number, and the difference between "today's work" and "Saturday's leftovers"
   * is exactly what a learner needs to see to make sense of a spike.
   */
  overdueReps: number;
  overdueCards: number;
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
  /**
   * Seven days starting with today (`dayOffset: 0`).
   *
   * Today used to be missing entirely — the chart began tomorrow — so a learner
   * who had just cleared 1439 repetitions saw no trace of them and read the
   * weekday labels as the days that had just passed. Today's column carries
   * both halves of the day: what is still waiting, and what has been done.
   */
  forecast: DeckForecastDay[];
  sources: DeckSourceStat[];
};

export type DeckForecastDay = {
  /** 0 = today, 1 = tomorrow, … */
  dayOffset: number;
  /** Repetitions scheduled for that day and not yet done. */
  count: number;
  /** Repetitions already reviewed that day. Only ever non-zero for today. */
  done: number;
  /** Local calendar date of the column, for labelling it unambiguously. */
  date: Date;
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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const stats: DeckStats = {
    totalCards: cards.length,
    byStatus: { new: 0, learning: 0, review: 0, relearning: 0 },
    dueCards: 0,
    dueReps: 0,
    dueByVariant: { forward: 0, reverse: 0, audio: 0 },
    overdueReps: 0,
    overdueCards: 0,
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
    forecast: Array.from({ length: FORECAST_DAYS }, (_, dayOffset) => {
      const date = new Date(todayStartMs);
      date.setDate(date.getDate() + dayOffset);
      return { dayOffset, count: 0, done: 0, date };
    }),
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
    let cardOverdue = false;
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
        stats.forecast[0].count += 1;
        // "New" has no date behind it — it is waiting, not late.
        if (p.status !== "new" && Date.parse(p.dueAt) < todayStartMs) {
          cardOverdue = true;
          stats.overdueReps += 1;
        }
      } else {
        const inDays = Math.ceil((Date.parse(p.dueAt) - todayEndMs) / dayMs);
        if (inDays >= 1 && inDays < FORECAST_DAYS) stats.forecast[inDays].count += 1;
      }

      const reviewedOn = dayKey(
        variant === "forward" ? card.lastReviewedAt : variantProgress[card.id]?.[variant]?.lastReviewedAt,
      );
      if (reviewedOn) {
        reviewDays.add(reviewedOn);
        if (reviewedOn === todayKey) {
          stats.reviewedToday += 1;
          stats.forecast[0].done += 1;
        }
      }
    }

    if (cardDue) {
      stats.dueCards += 1;
      source.due += 1;
    }
    if (cardOverdue) stats.overdueCards += 1;
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

const WEEKDAY_ACCUSATIVE = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** "сб" — the label under a forecast column. */
export function forecastWeekday(date: Date): string {
  return WEEKDAY_SHORT[date.getDay()];
}

/**
 * Names a forecast day the way a person would.
 *
 * A bare weekday is ambiguous the moment the same one has just passed: on a
 * Sunday, "в субботу" reads as yesterday, which is precisely how a forecast of
 * next Saturday's pile-up got mistaken for a report on the day before.
 */
export function describeForecastDay(day: DeckForecastDay): string {
  if (day.dayOffset === 0) return "сегодня";
  if (day.dayOffset === 1) return "завтра";
  if (day.dayOffset === 2) return "послезавтра";
  return `в ${WEEKDAY_ACCUSATIVE[day.date.getDay()]}, ${day.date.getDate()} ${MONTH_GENITIVE[day.date.getMonth()]}`;
}

/**
 * One sentence saying what the numbers add up to.
 *
 * It opens with today — what is left, and what has already been done, because a
 * cleared day deserves to be said out loud — then names the next heavy day with
 * its date, and finally the direction that is furthest behind.
 *
 * It needs no clock of its own: every forecast day arrived carrying its date.
 */
export function deckInsight(stats: DeckStats): string | null {
  if (stats.totalCards === 0) return null;

  const parts: string[] = [];

  if (stats.dueReps === 0) {
    parts.push(
      stats.reviewedToday > 0
        ? `Сегодня повторено ${stats.reviewedToday} — на сегодня всё`
        : "На сегодня всё повторено",
    );
  } else if (stats.overdueReps > 0) {
    parts.push(`Осталось ${stats.dueReps} повторений, из них ${stats.overdueReps} с прошлых дней`);
  } else {
    parts.push(`Осталось ${stats.dueReps} повторений`);
  }

  // The heaviest day still ahead. Today is excluded on purpose: it is already
  // covered by the clause above, and "впереди" must mean what it says.
  const ahead = stats.forecast.filter((day) => day.dayOffset > 0);
  const peak = ahead.reduce((best, day) => (day.count > best.count ? day : best), ahead[0]);
  if (peak && peak.count > 0) {
    parts.push(`самый нагруженный день впереди — ${describeForecastDay(peak)}: ${peak.count} повторений`);
  }

  const behind = [...ALL_TRAIN_VARIANTS].sort(
    (a, b) => stats.startedByVariant[a] - stats.startedByVariant[b],
  );
  const weakest = behind[0];
  const strongest = behind[behind.length - 1];
  // Only worth naming when the gap is real rather than a rounding difference.
  if (stats.startedByVariant[strongest] - stats.startedByVariant[weakest] >= Math.max(5, stats.totalCards * 0.05)) {
    parts.push(`главный резерв — ${VARIANT_NAMES[weakest]}: начато ${stats.startedByVariant[weakest]} из ${stats.totalCards}`);
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

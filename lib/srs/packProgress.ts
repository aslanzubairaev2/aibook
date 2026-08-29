// How far the learner has got through a pack in the Глаголы / Существительные
// trainers.
//
// Deliberately NOT the SM-2 schedule the flashcards use. That answers "what
// should I see today", accumulates forever and never visibly fills — which is
// exactly the feeling the learner described as "как будто вообще не двигаешься".
// This answers a different, much simpler question: «эту пачку я уже прошёл или
// нет, и что в ней осталось».
//
// So a word carries one bit that matters — was the LAST answer right — plus
// counters for context. Getting a word wrong does not push the bar backwards
// (nothing is taken away), it simply is not counted yet; answering it right on
// the retry fills that slot. A pack at 100% has been genuinely worked through.

export type PackModule = "verbs" | "nouns";

export type WordTrainingState = {
  /** Whether the most recent answer for this word was fully correct. */
  ok: boolean;
  /** Total times the word has come up in a session. */
  attempts: number;
  /** Total correct answers, for the "сколько раз подтвердил" line. */
  correct: number;
  /** When it was last answered, ms since epoch. */
  at: number;
};

/** Everything one module remembers: per-word state plus per-pack session meta. */
export type ModuleProgress = {
  words: Record<string, WordTrainingState>;
  packs: Record<string, { sessions: number; lastTrainedAt: number }>;
};

export type PackCoverage = {
  total: number;
  /** Words whose last answer was correct — the filled part of the bar. */
  learned: number;
  /** Words tried at least once but currently missed — the dim part of the bar. */
  seen: number;
  /** 0–100, rounded. What the pack head shows. */
  percent: number;
  /** 0–100, learned + seen: how much of the pack has been touched at all. */
  touchedPercent: number;
  sessions: number;
  lastTrainedAt: number;
};

export function emptyModuleProgress(): ModuleProgress {
  return { words: {}, packs: {} };
}

/**
 * A pack's coverage over the entry ids it currently holds.
 *
 * Reading the state per id (rather than storing a number on the pack) means a
 * pack that grew by three new words drops back below 100% on its own — which
 * is the honest answer to «я эту пачку прошёл?» once there is something in it
 * that has never been asked.
 */
export function packCoverage(
  progress: ModuleProgress,
  packKey: string,
  entryIds: string[],
): PackCoverage {
  const meta = progress.packs[packKey];
  let learned = 0;
  let seen = 0;

  for (const id of entryIds) {
    const state = progress.words[id];
    if (!state || state.attempts === 0) continue;
    if (state.ok) learned += 1;
    else seen += 1;
  }

  const total = entryIds.length;
  return {
    total,
    learned,
    seen,
    percent: total ? Math.round((learned / total) * 100) : 0,
    touchedPercent: total ? Math.round(((learned + seen) / total) * 100) : 0,
    sessions: meta?.sessions ?? 0,
    lastTrainedAt: meta?.lastTrainedAt ?? 0,
  };
}

/**
 * Folds one answered step into the module's state.
 *
 * A word can be asked several times in one session (перевод, артикль, мн. ч.),
 * and every one of those has to be right for the word to count: `ok` is ANDed
 * across the session so a learner who names the article but fumbles the plural
 * is not shown as having finished that word. Only the session's FIRST answer
 * for a word may set `ok` outright — which is why the caller, not this
 * function, owns the "already answered this session" set: this stays pure, so
 * React may safely call it twice with the same arguments.
 */
export function recordAnswer(
  progress: ModuleProgress,
  entryId: string,
  correct: boolean,
  firstThisSession: boolean,
  now: number,
): ModuleProgress {
  const prev = progress.words[entryId];
  const ok = firstThisSession ? correct : (prev?.ok ?? true) && correct;

  return {
    ...progress,
    words: {
      ...progress.words,
      [entryId]: {
        ok,
        attempts: (prev?.attempts ?? 0) + 1,
        correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
        at: now,
      },
    },
  };
}

/** Stamps a finished (or started) session on the pack, for the «последняя тренировка» line. */
export function recordSession(progress: ModuleProgress, packKey: string, now: number): ModuleProgress {
  const prev = progress.packs[packKey];
  return {
    ...progress,
    packs: {
      ...progress.packs,
      [packKey]: { sessions: (prev?.sessions ?? 0) + 1, lastTrainedAt: now },
    },
  };
}

/** Forgets everything about the given words — the pack's «сбросить прогресс». */
export function resetWords(progress: ModuleProgress, entryIds: string[], packKey?: string): ModuleProgress {
  const words = { ...progress.words };
  for (const id of entryIds) delete words[id];
  const packs = { ...progress.packs };
  if (packKey) delete packs[packKey];
  return { words, packs };
}

/** «сегодня» / «27 августа» — how the pack head dates its last session. */
export function formatTrainedAt(ms: number): string {
  if (!ms) return "";
  const then = new Date(ms);
  const today = new Date();
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay) return "сегодня";
  try {
    return then.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

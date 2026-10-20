// When each drill of a verb comes back — per drill, not per word.
//
// The Глаголы trainer used to offer every verb not yet finished today, every
// day: a hundred verbs × six persons × each tense, with no memory of which
// drills were already solid. And one answer bit per word meant «Формы» and
// «Спряжения» shared a verdict, so «fahren: forms fine, present shaky» could
// not even be said.
//
// Now each (verb, drill) pair — `translation`, `forms`, `conjugation:present`,
// `conjugation:perfekt`, … — carries its own FSRS schedule (the scheduler the
// flashcards use, lib/srs/fsrs.ts) plus its own answer counters. A session
// asks only the drills that are due, most overdue first, and stops at a daily
// size the learner picks; a drill answered right goes away for days, then
// weeks, and one answered wrong is back tomorrow.
//
// Words without drill history yet fall back to their old word-level state for
// «Незнакомые»/«Сложные», so switching over does not hide the existing
// mistakes; their schedule simply starts at the first answer.

import { reviewMemory, type MemoryProgress } from "@/lib/srs/fsrs";
import { adaptiveDifficultyScore, matchesTrainingFilter } from "@/lib/srs/adaptiveDifficulty";
import type { ModuleProgress, TrainingFilter, WordTrainingState } from "@/lib/srs/packProgress";
import type { CardStatus } from "@/lib/types";
import { CONJUGATION_TENSE_ORDER, QUIZ_MODE_ORDER, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";

export type DrillKey = "translation" | "forms" | "phrase" | `conjugation:${ConjugationTense}`;

export type DrillState = WordTrainingState & {
  status: CardStatus;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  dueAt: string;
  lastReviewedAt: string;
  stability: number;
  difficulty: number;
};

/** «Тренировать» takes at most this many verbs — 0 means no limit. */
export const SESSION_LIMIT_OPTIONS = [10, 20, 40, 0] as const;
export const DEFAULT_SESSION_LIMIT = 20;

export function drillId(entryId: string, drill: DrillKey): string {
  return `${entryId}|${drill}`;
}

export function conjugationDrill(tense: ConjugationTense): DrillKey {
  return `conjugation:${tense}`;
}

/** What a verb with these data can be asked under the switched-on modes, in play order. */
export function drillKeysFor(
  entry: { translation?: string | null; forms?: Record<string, string> | null },
  modes: ReadonlySet<QuizMode>,
  tenses: ReadonlySet<ConjugationTense>,
): DrillKey[] {
  const keys: DrillKey[] = [];
  for (const mode of QUIZ_MODE_ORDER) {
    if (!modes.has(mode)) continue;
    if (mode === "translation") {
      if (entry.translation?.trim()) keys.push("translation");
    } else if (mode === "forms") {
      if (entry.forms?.praeteritum || entry.forms?.partizip2) keys.push("forms");
    } else if (mode === "conjugation") {
      for (const tense of CONJUGATION_TENSE_ORDER) if (tenses.has(tense)) keys.push(conjugationDrill(tense));
    } else {
      keys.push("phrase");
    }
  }
  return keys;
}

export function getDrill(progress: ModuleProgress, entryId: string, drill: DrillKey): DrillState | undefined {
  return progress.drills?.[drillId(entryId, drill)];
}

/** Never asked, or its day has come. */
export function isDrillDue(state: DrillState | undefined, now: number = Date.now()): boolean {
  if (!state) return true;
  const due = Date.parse(state.dueAt);
  return !Number.isFinite(due) || due <= now;
}

function asMemory(state: DrillState | undefined): MemoryProgress {
  if (!state) return { status: "new", repetitions: 0, lapses: 0, intervalDays: 0, easeFactor: 2.5, dueAt: new Date(0).toISOString() };
  return { ...state, easeFactor: 2.5 };
}

/**
 * One graded answer to one drill. Only a drill's first answer in a session
 * moves its schedule — the «повторить ошибки» round is relearning, and
 * getting it right on the second try must not push it a week out.
 */
export function recordDrillAnswer(
  progress: ModuleProgress,
  entryId: string,
  drill: DrillKey,
  correct: boolean,
  firstThisSession: boolean,
  now: number,
): ModuleProgress {
  const id = drillId(entryId, drill);
  const prev = progress.drills?.[id];
  const counters = {
    ok: firstThisSession ? correct : (prev?.ok ?? true) && correct,
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
    at: now,
  };
  let next: DrillState;
  if (firstThisSession || !prev) {
    const update = reviewMemory(asMemory(prev), correct ? 3 : 1, new Date(now));
    next = { ...counters, ...update, lastReviewedAt: new Date(now).toISOString() };
  } else {
    next = { ...prev, ...counters };
  }
  return { ...progress, drills: { ...progress.drills, [id]: next } };
}

/** The drill's own state, or — before it has any — the word's old shared one. */
function filterState(progress: ModuleProgress, entryId: string, drill: DrillKey): WordTrainingState | undefined {
  return getDrill(progress, entryId, drill) ?? progress.words[entryId];
}

export type PlannedVerb<E> = { entry: E; drills: DrillKey[] };

/**
 * What one «Тренировать» press should ask.
 *
 * «Все»: only the drills that are due — those already seen first, most
 * overdue first, then never-asked ones — cut at `limit` verbs.
 * «Незнакомые» / «Сложные»: only the drills that match, hardest first,
 * whether or not they are due — the learner asked for exactly those.
 */
export function planVerbSession<E extends { id: string; translation?: string | null; forms?: Record<string, string> | null }>(
  entries: E[],
  progress: ModuleProgress,
  modes: ReadonlySet<QuizMode>,
  tenses: ReadonlySet<ConjugationTense>,
  filter: TrainingFilter,
  limit: number,
  now: number = Date.now(),
): PlannedVerb<E>[] {
  type Ranked = PlannedVerb<E> & { rank: number; fresh: boolean };
  const ranked: Ranked[] = [];
  for (const entry of entries) {
    const keys = drillKeysFor(entry, modes, tenses);
    if (filter === "all") {
      const due = keys.filter((key) => isDrillDue(getDrill(progress, entry.id, key), now));
      if (!due.length) continue;
      const seen = due.map((key) => getDrill(progress, entry.id, key)).filter((s): s is DrillState => !!s);
      const earliest = seen.length ? Math.min(...seen.map((s) => Date.parse(s.dueAt) || 0)) : Infinity;
      ranked.push({ entry, drills: due, rank: earliest, fresh: seen.length === 0 });
    } else {
      const matching = keys.filter((key) => matchesTrainingFilter(filterState(progress, entry.id, key), filter));
      if (!matching.length) continue;
      const score = Math.max(...matching.map((key) => adaptiveDifficultyScore(filterState(progress, entry.id, key))));
      ranked.push({ entry, drills: matching, rank: -score, fresh: false });
    }
  }
  // Stable sort keeps the dictionary's own order among equals — new verbs
  // come in the order they were added.
  ranked.sort((a, b) => Number(a.fresh) - Number(b.fresh) || a.rank - b.rank);
  const cut = limit > 0 ? ranked.slice(0, limit) : ranked;
  return cut.map(({ entry, drills }) => ({ entry, drills }));
}

/** How many verbs have at least one due drill — the number on the button. */
export function countDueVerbs(
  entries: Array<{ id: string; translation?: string | null; forms?: Record<string, string> | null }>,
  progress: ModuleProgress,
  modes: ReadonlySet<QuizMode>,
  tenses: ReadonlySet<ConjugationTense>,
  now: number = Date.now(),
): number {
  return entries.filter((entry) => drillKeysFor(entry, modes, tenses).some((key) => isDrillDue(getDrill(progress, entry.id, key), now))).length;
}

/** Verbs with at least one drill matching «Незнакомые»/«Сложные» under the current modes. */
export function countFilteredVerbs(
  entries: Array<{ id: string; translation?: string | null; forms?: Record<string, string> | null }>,
  progress: ModuleProgress,
  modes: ReadonlySet<QuizMode>,
  tenses: ReadonlySet<ConjugationTense>,
  filter: Exclude<TrainingFilter, "all">,
): number {
  return entries.filter((entry) => drillKeysFor(entry, modes, tenses).some((key) => matchesTrainingFilter(filterState(progress, entry.id, key), filter))).length;
}


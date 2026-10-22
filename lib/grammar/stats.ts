// Grammar-trainer practice in numbers — the same figures for the learner's
// screen and the teacher's MCP tools.
//
// What the numbers rest on:
//  - a first answer is the first event for a task (attempt 1, not a
//    correction, not a technical failure); a correction is reported next to
//    it, never in its place;
//  - answers given with the cheat sheet open are counted apart from
//    independent ones; «не знаю» counts as not right; technical failures and
//    answers the rules could not judge are never errors;
//  - quick choice, sentence building, writing and speaking are reported
//    separately: choosing a preposition from buttons is not producing it;
//  - each difference is counted by kind — wrong / missing / extra
//    preposition, case, gender, determiner form, conjugation, word order…;
//  - developer test runs (meta.test_run) are left out unless asked for.

import { ERROR_LABEL, MODE_LABEL, type ErrorType, type Mode, type TrainerId } from "./task";

export type GrammarEvent = {
  id?: string;
  client_event_id: string;
  occurred_at: string;
  local_date: string;
  session_id: string | null;
  trainer: string;
  mode: string | null;
  word: string;
  prompt: string | null;
  answer: string | null;
  expected: string | null;
  outcome: string;
  attempt_no: number;
  hint_used: boolean;
  answer_shown: boolean;
  meta: Record<string, unknown> & {
    key?: string;
    key_label?: string;
    response_mode?: string;
    answer_kind?: string;
    error_types?: string[];
    issues?: { type: string; expected: string | null; answered: string | null }[];
    feedback?: string[];
    correction_of?: string | null;
    repeat_of?: string | null;
    delayed_review?: boolean;
    test_run?: boolean;
  };
};

const CHECKED = new Set(["correct", "typo", "incorrect", "dont_know"]);

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

type Tally = { answers: number; checked: number; correct: number; typo: number; incorrect: number; dont_know: number; technical: number; needs_review: number };
function tally(): Tally { return { answers: 0, checked: 0, correct: 0, typo: 0, incorrect: 0, dont_know: 0, technical: 0, needs_review: 0 }; }
function count(t: Tally, e: GrammarEvent) {
  t.answers++;
  if (CHECKED.has(e.outcome)) t.checked++;
  if (e.outcome in t) (t as unknown as Record<string, number>)[e.outcome]++;
}
function report(t: Tally) {
  // A typo is a right answer with a slip: it counts as right, and is shown apart.
  return { ...t, right: t.correct + t.typo, accuracy_percent: pct(t.correct + t.typo, t.checked) };
}

export function isFirstAnswer(e: GrammarEvent): boolean {
  return e.attempt_no === 1 && !e.meta?.correction_of && e.outcome !== "technical";
}

export function withoutTests<T extends { meta?: Record<string, unknown> | null }>(events: T[]): T[] {
  return events.filter((e) => e.meta?.test_run !== true);
}

export function grammarSummary(raw: GrammarEvent[], opts: { includeTests?: boolean; mode?: string; key?: string } = {}) {
  const all = (opts.includeTests ? raw : withoutTests(raw))
    .filter((e) => !opts.mode || (e.meta.response_mode ?? e.mode) === opts.mode)
    .filter((e) => !opts.key || e.meta.key === opts.key)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const firsts = all.filter(isFirstAnswer);
  const totals = tally();
  const byMode = new Map<string, Tally>();
  const byKind = new Map<string, Tally>();
  const byDay = new Map<string, Tally>();
  const byKey = new Map<string, { label: string; t: Tally; errors: Map<string, number> }>();
  const errorTypes = new Map<string, number>();
  const errorTypesByMode = new Map<string, Map<string, number>>();
  const sessions = new Set<string>();

  for (const e of firsts) {
    const m = e.meta;
    count(totals, e);
    const mode = m.response_mode ?? e.mode ?? "unknown";
    if (!byMode.has(mode)) byMode.set(mode, tally());
    count(byMode.get(mode)!, e);
    const kind = m.answer_kind ?? (e.hint_used ? "assisted" : "independent");
    if (!byKind.has(kind)) byKind.set(kind, tally());
    count(byKind.get(kind)!, e);
    if (!byDay.has(e.local_date)) byDay.set(e.local_date, tally());
    count(byDay.get(e.local_date)!, e);
    if (e.session_id) sessions.add(e.session_id);
    const key = m.key ?? e.word;
    const slot = byKey.get(key) ?? { label: m.key_label ?? e.word, t: tally(), errors: new Map() };
    count(slot.t, e);
    if (e.outcome === "incorrect") {
      for (const type of m.error_types ?? []) {
        errorTypes.set(type, (errorTypes.get(type) ?? 0) + 1);
        slot.errors.set(type, (slot.errors.get(type) ?? 0) + 1);
        const pm = errorTypesByMode.get(mode) ?? new Map();
        pm.set(type, (pm.get(type) ?? 0) + 1);
        errorTypesByMode.set(mode, pm);
      }
    }
    byKey.set(key, slot);
  }

  const corrections = all.filter((e) => e.meta?.correction_of);
  const fixed = corrections.filter((e) => e.outcome === "correct" || e.outcome === "typo").length;
  const recent = firsts.filter((e) => e.outcome === "incorrect" || e.outcome === "dont_know").slice(-12).reverse().map((e) => {
    const correction = corrections.filter((c) => c.meta.correction_of === e.client_event_id).pop();
    return {
      at: e.occurred_at,
      mode: e.meta.response_mode,
      answer_kind: e.meta.answer_kind,
      construction: e.meta.key_label ?? e.word,
      prompt: e.prompt,
      expected: e.expected,
      first_answer: e.answer,
      outcome: e.outcome,
      error_types: e.meta.error_types ?? [],
      feedback: e.meta.feedback ?? [],
      correction: correction ? { answer: correction.answer, outcome: correction.outcome } : null,
      event_id: e.id ?? null,
    };
  });

  const labelled = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, label: ERROR_LABEL[type as ErrorType] ?? type, count: n }));
  return {
    first_answers: report(totals),
    by_mode: Object.fromEntries([...byMode].map(([k, t]) => [k, { label: MODE_LABEL[k as Mode] ?? k, ...report(t) }])),
    by_answer_kind: Object.fromEntries([...byKind].map(([k, t]) => [k, report(t)])),
    error_types: labelled(errorTypes),
    error_types_by_mode: Object.fromEntries([...errorTypesByMode].map(([k, m]) => [k, labelled(m)])),
    constructions: [...byKey].map(([key, s]) => ({ key, label: s.label, ...report(s.t), errors: labelled(s.errors) }))
      .sort((a, b) => b.incorrect + b.dont_know - (a.incorrect + a.dont_know) || b.answers - a.answers),
    corrections: { count: corrections.length, right_after_correction: fixed },
    technical_problems: all.filter((e) => e.outcome === "technical").length,
    awaiting_review: all.filter((e) => e.outcome === "needs_review").length,
    repeats: { after_error_in_session: firsts.filter((e) => e.meta.repeat_of).length, delayed_from_earlier_sessions: firsts.filter((e) => e.meta.delayed_review).length },
    sessions: sessions.size,
    trend_by_day: [...byDay].map(([day, t]) => ({ day, ...report(t) })),
    recent_errors: recent,
    test_events_excluded: opts.includeTests ? 0 : raw.length - withoutTests(raw).length,
  };
}

/**
 * Constructions due again: an error (or «не знаю») in a first answer that no
 * later session has since answered right on its own. They come back in the
 * next sessions with other words.
 */
export function dueKeys(raw: GrammarEvent[], limit = 6): string[] {
  const firsts = withoutTests(raw).filter(isFirstAnswer).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const state = new Map<string, { at: string; session: string | null; cleared: boolean }>();
  for (const e of firsts) {
    const key = e.meta.key;
    if (!key) continue;
    if (e.outcome === "incorrect" || e.outcome === "dont_know") state.set(key, { at: e.occurred_at, session: e.session_id, cleared: false });
    else if ((e.outcome === "correct" || e.outcome === "typo") && e.meta.answer_kind !== "assisted") {
      const s = state.get(key);
      if (s && e.session_id !== s.session) s.cleared = true;
    }
  }
  return [...state].filter(([, s]) => !s.cleared).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, limit).map(([k]) => k);
}

export function trainerOf(e: { trainer: string }): TrainerId | null {
  return e.trainer === "verb_prepositions" || e.trainer === "articles_cases" ? e.trainer : null;
}

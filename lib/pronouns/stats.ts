// Pronoun practice in numbers — the same figures for the learner's screen and
// the teacher's MCP tools.
//
// What the numbers rest on:
//  - a first answer is the first event for a task (attempt 1, not a
//    correction). Corrections are reported, never swapped in for it;
//  - accuracy counts «не знаю» as not right; technical failures (speech) and
//    answers the rules could not judge are counted apart and never as errors;
//  - each part of the answer is reported on its own: picking the right verb
//    form while choosing the wrong participant shows as exactly that;
//  - a teacher's re-grade replaces the automatic verdict in the figures and is
//    shown next to it; the original stays in the history;
//  - «уверенно» needs independent (written or spoken) first answers right in
//    several sessions and on several verbs — never a run of multiple choice.

import { PRONOUNS, type PronounId } from "./catalog";
import { COMPONENTS, type Component, type ComponentVerdict, type Confusion } from "./check";

export type PronounMeta = {
  task_id?: string;
  template_version?: string;
  kind?: "people" | "noun";
  verb?: string;
  noun?: string | null;
  constructions?: string[];
  sentence_type?: string;
  modal?: boolean;
  response_mode?: string;
  focus_role?: "subject" | "object";
  difficulty?: string;
  case?: string;
  target?: { subject?: { id: PronounId }; object?: { id: PronounId } };
  components?: Partial<Record<Component, ComponentVerdict>>;
  confusions?: Confusion[];
  error_kind?: string | null;
  agreement_ok?: boolean | null;
  feedback?: string[];
  check_method?: "rules" | "model" | "teacher";
  correction_of?: string | null;
  delayed_review?: boolean;
  recheck_of?: string | null;
  followup_of?: string | null;
  assigned_session_id?: string | null;
  active_ms?: number | null;
  speech?: { transcript?: string; confidence?: number | null; recognition_ms?: number | null } | null;
  technical_reason?: string | null;
};

export type PronounEvent = {
  id?: string;
  client_event_id: string;
  occurred_at: string;
  local_date: string;
  session_id: string | null;
  mode: string | null;
  word: string;
  prompt: string | null;
  answer: string | null;
  expected: string | null;
  outcome: string;
  attempt_no: number;
  hint_used: boolean;
  answer_shown: boolean;
  meta: PronounMeta & Record<string, unknown>;
};

export type AnswerReview = {
  event_id: string;
  outcome: string | null;
  components: Partial<Record<Component, ComponentVerdict>> | null;
  note: string | null;
  reviewer: string;
  created_at: string;
};

export type PronounFilters = {
  case?: string;
  response_mode?: string;
  construction?: string;
  verb?: string;
  role?: "subject" | "object";
  pronoun?: PronounId;
};

const CHECKED = new Set(["correct", "typo", "incorrect", "dont_know"]);
const INDEPENDENT = new Set(["written", "spoken"]);

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function formLabel(id: PronounId, role: "subject" | "object"): string {
  const p = PRONOUNS[id];
  const form = role === "subject" ? p.nom : p.acc;
  // «sie» is three different people; the teacher needs to know which.
  if (id === "sie_sg") return `${form} (${role === "subject" ? "она" : "её"})`;
  if (id === "sie_pl") return `${form} (${role === "subject" ? "они" : "их"})`;
  if (id === "Sie") return `${form} (${role === "subject" ? "Вы" : "Вас"})`;
  return form;
}

/** Apply the latest teacher review of each event; keep what the machine said. */
export function applyReviews(events: PronounEvent[], reviews: AnswerReview[]): (PronounEvent & { review?: AnswerReview; automatic?: { outcome: string; components?: PronounMeta["components"] } })[] {
  const latest = new Map<string, AnswerReview>();
  for (const r of [...reviews].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(r.event_id, r);
  return events.map((e) => {
    const r = e.id ? latest.get(e.id) : undefined;
    if (!r) return e;
    return {
      ...e,
      outcome: r.outcome ?? e.outcome,
      meta: { ...e.meta, components: { ...(e.meta.components ?? {}), ...(r.components ?? {}) }, check_method: "teacher" },
      review: r,
      automatic: { outcome: e.outcome, components: e.meta.components },
    };
  });
}

export function matchesFilters(e: PronounEvent, f: PronounFilters): boolean {
  const m = e.meta ?? {};
  if (f.case && (m.case ?? "accusative") !== f.case) return false;
  if (f.response_mode && (m.response_mode ?? e.mode) !== f.response_mode) return false;
  if (f.construction && !(m.constructions ?? []).includes(f.construction)) return false;
  if (f.verb && m.verb !== f.verb) return false;
  if (f.pronoun) {
    const s = m.target?.subject?.id === f.pronoun;
    const o = m.target?.object?.id === f.pronoun;
    if (f.role === "subject" ? !s : f.role === "object" ? !o : !s && !o) return false;
  } else if (f.role && m.focus_role !== f.role) return false;
  return true;
}

/** A technical failure (speech) is not an answer: the task's real first answer comes after it. */
export function isFirstAnswer(e: PronounEvent): boolean {
  return e.attempt_no === 1 && !e.meta?.correction_of && e.outcome !== "technical";
}

type Tally = { answers: number; checked: number; correct: number; typo: number; incorrect: number; dont_know: number; skipped: number; technical: number; needs_review: number };

function tally(): Tally {
  return { answers: 0, checked: 0, correct: 0, typo: 0, incorrect: 0, dont_know: 0, skipped: 0, technical: 0, needs_review: 0 };
}

function count(t: Tally, e: PronounEvent) {
  t.answers++;
  if (CHECKED.has(e.outcome)) t.checked++;
  if (e.outcome in t) (t as unknown as Record<string, number>)[e.outcome]++;
}

function report(t: Tally) {
  return { ...t, accuracy_percent: pct(t.correct, t.checked) };
}

export function pronounSummary(raw: PronounEvent[], reviews: AnswerReview[] = [], filters: PronounFilters = {}) {
  const all = applyReviews(raw, reviews).filter((e) => matchesFilters(e, filters))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const firsts = all.filter(isFirstAnswer);

  const totals = tally();
  const independent = tally();
  const byMode = new Map<string, Tally>();
  const byDay = new Map<string, Tally>();
  const components: Record<string, { checked: number; correct: number; errors: number; typos: number }> = {};
  const confusion = new Map<string, { role: string; expected: string; answered: string; kind: string; count: number }>();
  const coverage = { subjects: new Set<string>(), objects: new Set<string>(), verbs: new Set<string>(), constructions: new Set<string>(), combinations: new Set<string>(), sessions: new Set<string>() };
  const delayed = tally();
  let hints = 0, shown = 0;

  for (const e of firsts) {
    const m = e.meta;
    count(totals, e);
    if (INDEPENDENT.has(m.response_mode ?? "")) count(independent, e);
    const mode = m.response_mode ?? e.mode ?? "unknown";
    if (!byMode.has(mode)) byMode.set(mode, tally());
    count(byMode.get(mode)!, e);
    if (!byDay.has(e.local_date)) byDay.set(e.local_date, tally());
    count(byDay.get(e.local_date)!, e);
    if (e.hint_used) hints++;
    if (e.answer_shown) shown++;
    if (m.delayed_review || m.recheck_of) count(delayed, e);
    if (CHECKED.has(e.outcome) && e.outcome !== "dont_know") {
      for (const [c, v] of Object.entries(m.components ?? {})) {
        const slot = components[c] ?? { checked: 0, correct: 0, errors: 0, typos: 0 };
        slot.checked++;
        if (v === "correct") slot.correct++;
        else if (v === "typo") slot.typos++;
        else slot.errors++;
        components[c] = slot;
      }
      for (const c of m.confusions ?? []) {
        const answered = c.kind === "role_swap" ? "роли перепутаны" : c.kind === "noun_kept" ? "существительное не заменено" : c.answered_form ?? "—";
        const key = `${c.role}|${c.expected}|${answered}`;
        const item = confusion.get(key) ?? { role: c.role, expected: formLabel(c.expected, c.role), answered, kind: c.kind, count: 0 };
        item.count++;
        confusion.set(key, item);
      }
    }
    if (m.target?.subject?.id) coverage.subjects.add(m.target.subject.id);
    if (m.target?.object?.id && m.kind !== "noun") coverage.objects.add(m.target.object.id);
    if (m.verb) coverage.verbs.add(m.verb);
    for (const c of m.constructions ?? []) coverage.constructions.add(c);
    coverage.combinations.add(`${m.target?.subject?.id}>${m.target?.object?.id}|${m.verb}`);
    if (e.session_id) coverage.sessions.add(e.session_id);
  }

  const corrections = all.filter((e) => e.meta?.correction_of);
  const fixed = corrections.filter((e) => e.outcome === "correct" || e.outcome === "typo").length;

  const examples = firsts.filter((e) => e.outcome === "incorrect" || e.outcome === "dont_know" || e.outcome === "typo").slice(-12).reverse().map((e) => {
    const correction = corrections.filter((c) => c.meta.correction_of === e.client_event_id).pop();
    return {
      at: e.occurred_at,
      mode: e.meta.response_mode,
      verb: e.meta.verb,
      prompt: e.prompt,
      expected: e.expected,
      first_answer: e.answer,
      outcome: e.outcome,
      errors_in: Object.entries(e.meta.components ?? {}).filter(([, v]) => v !== "correct").map(([k]) => k),
      feedback: e.meta.feedback ?? [],
      correction: correction ? { answer: correction.answer, outcome: correction.outcome } : null,
      teacher_review: (e as { review?: AnswerReview }).review ?? null,
      automatic_verdict: (e as { automatic?: unknown }).automatic ?? null,
    };
  });

  return {
    template: "pron-v1",
    case: filters.case ?? "accusative",
    first_answers: report(totals),
    first_independent_answers: { ...report(independent), note: "Written and spoken only — choice and gaps are recognition." },
    by_component: Object.fromEntries(COMPONENTS.filter((c) => components[c]).map((c) => [c, { ...components[c], accuracy_percent: pct(components[c].correct, components[c].checked) }])),
    by_mode: Object.fromEntries([...byMode].map(([k, t]) => [k, report(t)])),
    confusion_matrix: [...confusion.values()].sort((a, b) => b.count - a.count),
    hints_used: hints,
    answers_shown: shown,
    corrections: { count: corrections.length, right_after_correction: fixed },
    technical_problems: all.filter((e) => e.outcome === "technical").length,
    awaiting_review: all.filter((e) => e.outcome === "needs_review").length,
    trend_by_day: [...byDay].map(([day, t]) => ({ day, first_answers: t.answers, checked: t.checked, correct: t.correct, accuracy_percent: pct(t.correct, t.checked) })),
    coverage: {
      sessions: coverage.sessions.size,
      subjects: [...coverage.subjects],
      objects: [...coverage.objects],
      verbs: [...coverage.verbs],
      constructions: [...coverage.constructions],
      combinations: coverage.combinations.size,
    },
    delayed_checks: report(delayed),
    mastery: mastery(firsts),
    recent_difficulties: examples,
  };
}

/** Per difficulty («object:wir»): what recognition, writing and speaking each show. */
export function mastery(firsts: PronounEvent[]) {
  const by = new Map<string, { recognition: Tally; written: Tally; spoken: Tally; sessions: Set<string>; verbs: Set<string>; lastIndependent: string[] }>();
  for (const e of firsts) {
    const key = e.meta.difficulty;
    if (!key || !CHECKED.has(e.outcome)) continue;
    const slot = by.get(key) ?? { recognition: tally(), written: tally(), spoken: tally(), sessions: new Set(), verbs: new Set(), lastIndependent: [] };
    const mode = e.meta.response_mode ?? "";
    count(mode === "spoken" ? slot.spoken : mode === "written" ? slot.written : slot.recognition, e);
    if (INDEPENDENT.has(mode)) {
      slot.lastIndependent.push(e.outcome);
      if (e.outcome === "correct" || e.outcome === "typo") {
        if (e.session_id) slot.sessions.add(e.session_id);
        if (e.meta.verb) slot.verbs.add(e.meta.verb);
      }
    }
    by.set(key, slot);
  }
  return [...by].map(([difficulty, s]) => {
    const recent = s.lastIndependent.slice(-3);
    const confident = s.sessions.size >= 2 && s.verbs.size >= 2 && recent.length >= 2 && recent.every((o) => o === "correct" || o === "typo");
    const independentAnswers = s.written.checked + s.spoken.checked;
    const status = confident ? "confident" : independentAnswers === 0 ? (s.recognition.checked ? "recognition_only" : "not_started") : "practising";
    return {
      difficulty,
      label: labelDifficulty(difficulty),
      status,
      recognition: report(s.recognition),
      written: report(s.written),
      spoken: report(s.spoken),
      independent_correct_sessions: s.sessions.size,
      independent_correct_verbs: [...s.verbs],
    };
  }).sort((a, b) => a.difficulty.localeCompare(b.difficulty));
}

export function labelDifficulty(key: string): string {
  const [role, value] = key.split(":");
  if (role === "noun") return `замена существительного (${value === "m" ? "der → ihn" : value === "f" ? "die → sie" : value === "n" ? "das → es" : "мн. ч. → sie"})`;
  if (!(value in PRONOUNS)) return key;
  return `${role === "subject" ? "подлежащее" : "дополнение"} ${formLabel(value as PronounId, role as "subject" | "object")}`;
}

const ROLE_RU = { subject: "подлежащего", object: "дополнения" } as const;

/**
 * For get_learning_gaps: confusions that repeat in first answers, each with
 * its evidence. One error is listed as one error — no conclusion is drawn.
 */
export function pronounGaps(raw: PronounEvent[], reviews: AnswerReview[] = []) {
  const summary = pronounSummary(raw, reviews);
  const firsts = applyReviews(raw, reviews).filter(isFirstAnswer);
  const repeated = summary.confusion_matrix.filter((c) => c.count >= 2).map((c) => ({
    source: "trainer:pronouns",
    role: c.role,
    expected: c.expected,
    answered: c.answered,
    first_answers: c.count,
    evidence: c.answered === "роли перепутаны"
      ? `В ${c.count} первых ответах перепутаны роли: ${c.expected} должно быть ${ROLE_RU[c.role as "subject" | "object"]}.`
      : `В ${c.count} первых ответах использовано ${c.answered} вместо ${c.expected} в роли ${ROLE_RU[c.role as "subject" | "object"]}.`,
  }));
  const single = summary.confusion_matrix.filter((c) => c.count === 1).map((c) => ({
    source: "trainer:pronouns", role: c.role, expected: c.expected, answered: c.answered,
    evidence: c.answered === "роли перепутаны"
      ? `Одна ошибка: перепутаны роли (${c.expected} должно быть ${ROLE_RU[c.role as "subject" | "object"]}) — недостаточно для вывода.`
      : `Одна ошибка (${c.answered} вместо ${c.expected}) — недостаточно для вывода.`,
  }));
  const parts = Object.entries(summary.by_component)
    .filter(([k, v]) => k !== "subject" && k !== "object" && v.errors >= 2)
    .map(([k, v]) => ({ source: "trainer:pronouns", component: k, errors: v.errors, checked: v.checked, evidence: `${k}: ${v.errors} ошибок в ${v.checked} первых ответах.` }));
  return { repeated_confusions: repeated, single_errors: single, other_components: parts, first_answers_considered: firsts.length };
}

/**
 * Difficulties due for a delayed check: an error in a first answer that no
 * later session has answered right independently since.
 */
export function dueDifficulties(raw: PronounEvent[], reviews: AnswerReview[] = [], limit = 5): string[] {
  const firsts = applyReviews(raw, reviews).filter(isFirstAnswer).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const state = new Map<string, { errorAt: string; errorSession: string | null; cleared: boolean }>();
  for (const e of firsts) {
    const key = e.meta.difficulty;
    if (!key) continue;
    if (e.outcome === "incorrect" || e.outcome === "dont_know") {
      state.set(key, { errorAt: e.occurred_at, errorSession: e.session_id, cleared: false });
    } else if ((e.outcome === "correct" || e.outcome === "typo") && INDEPENDENT.has(e.meta.response_mode ?? "")) {
      const s = state.get(key);
      if (s && e.session_id !== s.errorSession) s.cleared = true;
    }
  }
  return [...state].filter(([, s]) => !s.cleared).sort((a, b) => b[1].errorAt.localeCompare(a[1].errorAt)).slice(0, limit).map(([k]) => k);
}

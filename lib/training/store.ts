// Training events in the database: stored from the browser's batches, read
// back by the teacher's MCP tools. Service-role client, scoped by user id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKS, OUTCOMES, TRAINERS, dayInZone, normalizeEvent, type TrainingEvent } from "./events";
import { summarizeTraining, type StoredEvent } from "./summary";
import { pronounGaps, pronounSummary, type PronounEvent } from "@/lib/pronouns/stats";
import { pronounFilters, readReviews } from "@/lib/pronouns/store";
import { grammarSummary, trainerOf, type GrammarEvent } from "@/lib/grammar/stats";
import { ERROR_TYPES, MODES, TRAINER_IDS } from "@/lib/grammar/task";

const COLUMNS =
  "id, client_event_id, occurred_at, local_date, time_zone, trainer, mode, session_id, entry_id, card_id, word, checks, form, pronoun, tense, prompt, answer, expected, outcome, attempt_no, hint_used, answer_shown, self_grade, meta";

/** Insert a batch; an event already stored (a resend after a lost reply) is skipped. */
export async function storeEvents(admin: SupabaseClient, userId: string, raw: unknown[]) {
  const events = raw.slice(0, 500).map(normalizeEvent).filter((e): e is TrainingEvent => e !== null);
  if (events.length === 0) return { received: raw.length, stored: 0, rejected: raw.length };
  const { data, error } = await admin
    .from("training_events")
    .upsert(events.map((e) => ({ ...e, user_id: userId })), { onConflict: "user_id,client_event_id", ignoreDuplicates: true })
    .select("client_event_id");
  if (error) throw new Error(`training events insert failed: ${error.message}`);
  // With ignoreDuplicates only newly inserted rows come back.
  const stored = data?.length ?? 0;
  return { received: raw.length, stored, duplicates: events.length - stored, rejected: raw.length - events.length };
}

async function latestTimeZone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("training_events").select("time_zone").eq("user_id", userId)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.time_zone as string) || "UTC";
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A named period or explicit dates → an inclusive local-date range in the learner's zone. */
export async function resolvePeriod(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const zone = typeof args.time_zone === "string" && args.time_zone ? args.time_zone : await latestTimeZone(admin, userId);
  const today = dayInZone(zone);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  let from = date(args.from);
  let to = date(args.to);
  if (!from && !to) {
    switch (args.period) {
      case "yesterday": from = to = shiftDay(today, -1); break;
      case "last_7_days": from = shiftDay(today, -6); to = today; break;
      case "last_30_days": from = shiftDay(today, -29); to = today; break;
      case "all": from = "2000-01-01"; to = today; break;
      default: from = to = today;
    }
  }
  return { from: from ?? "2000-01-01", to: to ?? today, time_zone: zone, today };
}

async function readEvents(admin: SupabaseClient, userId: string, range: { from: string; to: string }, filters: Record<string, unknown>, limit = 1000, offset = 0) {
  let query = admin.from("training_events").select(COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .gte("local_date", range.from)
    .lte("local_date", range.to)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (typeof filters.trainer === "string" && (TRAINERS as readonly string[]).includes(filters.trainer)) query = query.eq("trainer", filters.trainer);
  if (typeof filters.checks === "string" && (CHECKS as readonly string[]).includes(filters.checks)) query = query.eq("checks", filters.checks);
  if (typeof filters.outcome === "string" && (OUTCOMES as readonly string[]).includes(filters.outcome)) query = query.eq("outcome", filters.outcome);
  if (filters.only_errors === true) query = query.in("outcome", ["incorrect", "typo", "dont_know"]);
  if (typeof filters.word === "string" && filters.word.trim()) {
    const word = filters.word.trim().replace(/[%_,()]/g, " ");
    query = query.ilike("word", `%${word}%`);
  }
  if (typeof filters.entry_id === "string" && filters.entry_id) query = query.eq("entry_id", filters.entry_id);
  // A developer's test runs are marked in meta and stay out of every figure unless asked for.
  if (filters.include_test_events !== true) query = query.not("meta", "cs", JSON.stringify({ test_run: true }));
  // Grammar trainers («Глаголы и предлоги», «Артикли и падежи») keep their task in meta too.
  if (typeof filters.trainer === "string" && (TRAINER_IDS as readonly string[]).includes(filters.trainer)) {
    if (typeof filters.response_mode === "string" && (MODES as readonly string[]).includes(filters.response_mode)) query = query.contains("meta", { response_mode: filters.response_mode });
    if (typeof filters.construction_key === "string" && filters.construction_key) query = query.contains("meta", { key: filters.construction_key });
    if (typeof filters.answer_kind === "string" && filters.answer_kind) query = query.contains("meta", { answer_kind: filters.answer_kind });
    if (typeof filters.error_type === "string" && (ERROR_TYPES as readonly string[]).includes(filters.error_type)) query = query.contains("meta", { error_types: [filters.error_type] });
  }
  // Pronoun practice keeps its task in meta; its filters read it there, in SQL, so paging stays exact.
  const p = pronounFilters(filters);
  if (p.verb) query = query.contains("meta", { verb: p.verb });
  if (p.response_mode) query = query.contains("meta", { response_mode: p.response_mode });
  if (p.construction) query = query.contains("meta", { constructions: [p.construction] });
  if (p.case) query = query.contains("meta", { case: p.case });
  if (p.pronoun && p.role) query = query.contains("meta", { target: { [p.role]: { id: p.pronoun } } });
  else if (p.pronoun) query = query.or(`meta->target->subject->>id.eq.${p.pronoun},meta->target->object->>id.eq.${p.pronoun}`);
  else if (p.role) query = query.contains("meta", { focus_role: p.role });
  const { data, error, count } = await query;
  if (error) throw new Error(`training events read failed: ${error.message}`);
  return { rows: (data ?? []) as StoredEvent[], total: count ?? 0 };
}

export async function trainingHistory(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const range = await resolvePeriod(admin, userId, { period: "last_7_days", ...args });
  const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
  const offset = Math.max(0, Number(args.offset) || 0);
  const { rows, total } = await readEvents(admin, userId, range, args, limit, offset);
  const reviews = rows.some((e) => e.trainer === "pronouns" || trainerOf(e)) ? await readReviews(admin, userId) : [];
  return {
    period: range,
    total,
    offset,
    returned: rows.length,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    events: rows.map((e) => ({
      at: e.occurred_at,
      day: e.local_date,
      trainer: e.trainer,
      mode: e.mode,
      word: e.word,
      entry_id: e.entry_id,
      card_id: e.card_id,
      checks: e.checks,
      form: e.form,
      pronoun: e.pronoun,
      tense: e.tense,
      prompt: e.prompt,
      answer: e.answer,
      expected: e.expected,
      outcome: e.outcome,
      first_try: e.attempt_no === 1,
      attempt_no: e.attempt_no,
      hint_used: e.hint_used,
      answer_shown: e.answer_shown,
      self_grade: e.self_grade,
      session_id: e.session_id,
      event_id: e.id,
      client_event_id: e.client_event_id,
      ...(e.trainer === "pronouns" ? { pronoun_task: pronounDetails(e, reviews.filter((r) => r.event_id === e.id)) } : {}),
      ...(trainerOf(e) ? { grammar_task: grammarDetails(e, reviews.filter((r) => r.event_id === e.id)) } : {}),
    })),
  };
}

/** What the teacher needs to read one pronoun answer: the task, each part's verdict, the explanation, any correction and re-grade. */
function pronounDetails(e: StoredEvent, reviews: { outcome: string | null; components: unknown; note: string | null; created_at: string }[]) {
  const m = e.meta as Record<string, unknown>;
  const latest = reviews[reviews.length - 1];
  return {
    response_mode: m.response_mode, verb: m.verb, noun: m.noun, constructions: m.constructions, sentence_type: m.sentence_type,
    target: m.target, expected_forms: m.expected_forms, components: m.components, confusions: m.confusions,
    error_kind: m.error_kind, agreement_ok: m.agreement_ok, feedback: m.feedback, uncertain_reason: m.uncertain_reason,
    first_answer: e.attempt_no === 1 && !m.correction_of, correction_of: m.correction_of ?? null,
    delayed_review: m.delayed_review ?? false, recheck_of: m.recheck_of ?? null, followup_of: m.followup_of ?? null,
    assigned_session_id: m.assigned_session_id ?? null, active_ms: m.active_ms ?? null, speech: m.speech ?? null,
    technical_reason: m.technical_reason ?? null, check_method: latest ? "teacher" : m.check_method ?? "rules",
    effective_outcome: latest?.outcome ?? e.outcome, reviews,
  };
}

/** One grammar-trainer answer as the teacher reads it: the construction, mode, kind of answer, each named difference, the correction link. */
function grammarDetails(e: StoredEvent, reviews: { outcome: string | null; components: unknown; note: string | null; created_at: string }[]) {
  const m = e.meta as Record<string, unknown>;
  const latest = reviews[reviews.length - 1];
  return {
    construction: m.key, construction_label: m.key_label, response_mode: m.response_mode, answer_kind: m.answer_kind,
    combination: m.combo ?? null, preposition: m.preposition ?? null, case: m.case ?? null, frame: m.frame ?? null, slots: m.slots ?? null,
    sentence_type: m.sentence_type ?? null, object_kind: m.object_kind ?? null,
    error_types: m.error_types, issues: m.issues, typos: m.typos, feedback: m.feedback, uncertain_reason: m.uncertain_reason,
    first_answer: e.attempt_no === 1 && !m.correction_of, correction_of: m.correction_of ?? null,
    repeat_of: m.repeat_of ?? null, delayed_review: m.delayed_review ?? false, assigned_session_id: m.assigned_session_id ?? null,
    active_ms: m.active_ms ?? null, speech: m.speech ?? null, technical_reason: m.technical_reason ?? null,
    test_run: m.test_run === true, check_method: latest ? "teacher" : m.check_method ?? "rules",
    effective_outcome: latest?.outcome ?? e.outcome, reviews,
  };
}

/** Every event in a range, page by page: the API hands out at most 1000 rows per request. */
async function readAll(admin: SupabaseClient, userId: string, range: { from: string; to: string }, filters: Record<string, unknown>, cap = 10000) {
  const rows: StoredEvent[] = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += 1000) {
    const page = await readEvents(admin, userId, range, filters, 1000, offset);
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length < 1000) break;
  }
  return { rows, total };
}

export async function trainingSummary(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const range = await resolvePeriod(admin, userId, args);
  const { rows, total } = await readAll(admin, userId, range, args);
  const summary = summarizeTraining(rows, { from: range.from, to: range.to, time_zone: range.time_zone });
  const pronounRows = rows.filter((e) => e.trainer === "pronouns");
  const pronouns = pronounRows.length || args.trainer === "pronouns"
    ? pronounSummary(pronounRows as unknown as PronounEvent[], await readReviews(admin, userId), pronounFilters(args))
    : undefined;
  const grammar: Record<string, unknown> = {};
  for (const trainer of TRAINER_IDS) {
    const own = rows.filter((e) => e.trainer === trainer);
    if (own.length || args.trainer === trainer) grammar[trainer] = grammarSummary(own as unknown as GrammarEvent[], { includeTests: args.include_test_events === true });
  }
  return {
    ...summary,
    ...(pronouns ? { pronouns } : {}),
    ...(Object.keys(grammar).length ? { grammar_trainers: grammar } : {}),
    events_considered: rows.length,
    truncated: total > rows.length,
    note: rows.length === 0
      ? "No training answers were recorded in this period. History exists only from the moment event logging shipped; older practice left only aggregate counters, which are not reconstructed."
      : "Counts come from recorded answers. Knowledge kinds are kept apart: knowing a translation, an article, a verb form and using the word in a sentence are reported separately (by_check, word_knowledge).",
  };
}

/** Errors from the trainers for get_learning_gaps, each tagged with where it came from. */
export async function trainerErrors(admin: SupabaseClient, userId: string, days = 14) {
  const range = await resolvePeriod(admin, userId, { period: days >= 30 ? "last_30_days" : "last_7_days" });
  const { rows } = await readAll(admin, userId, range, { only_errors: true }, 2000);
  const byItem = new Map<string, { source: string; word: string; checks: string; form: string | null; pronoun: string | null; tense: string | null; expected: string | null; answers: string[]; times: number; last_at: string }>();
  for (const e of rows) {
    const key = [e.trainer, e.word.toLocaleLowerCase(), e.checks, e.form, e.pronoun, e.tense].join("|");
    const item = byItem.get(key) ?? { source: `trainer:${e.trainer}`, word: e.word, checks: e.checks, form: e.form, pronoun: e.pronoun, tense: e.tense, expected: e.expected, answers: [], times: 0, last_at: e.occurred_at };
    item.times++;
    if (e.answer && item.answers.length < 4) item.answers.push(e.answer);
    byItem.set(key, item);
  }
  return { period: range, errors: [...byItem.values()].sort((a, b) => b.times - a.times).slice(0, 60) };
}

/** Pronoun confusions for get_learning_gaps, each with the first answers it rests on. */
export async function pronounTrainerGaps(admin: SupabaseClient, userId: string) {
  const range = await resolvePeriod(admin, userId, { period: "last_30_days" });
  const { rows } = await readAll(admin, userId, range, { trainer: "pronouns" }, 3000);
  return { period: range, ...pronounGaps(rows as unknown as PronounEvent[], await readReviews(admin, userId)) };
}

/** Pronoun practice answers for the learner's own statistics screen. */
export async function readPronounEvents(admin: SupabaseClient, userId: string, period: "last_30_days" | "all" = "all") {
  const range = await resolvePeriod(admin, userId, { period });
  const { rows } = await readAll(admin, userId, range, { trainer: "pronouns" }, 5000);
  return rows as unknown as PronounEvent[];
}

/** One grammar trainer's answers for the learner's own screens (statistics, due constructions). */
export async function readGrammarEvents(admin: SupabaseClient, userId: string, trainer: string, period: "last_30_days" | "all" = "all") {
  const range = await resolvePeriod(admin, userId, { period });
  const { rows } = await readAll(admin, userId, range, { trainer }, 5000);
  return rows as unknown as GrammarEvent[];
}

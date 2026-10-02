// Training events in the database: stored from the browser's batches, read
// back by the teacher's MCP tools. Service-role client, scoped by user id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKS, OUTCOMES, TRAINERS, dayInZone, normalizeEvent, type TrainingEvent } from "./events";
import { summarizeTraining, type StoredEvent } from "./summary";

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
  const { data, error, count } = await query;
  if (error) throw new Error(`training events read failed: ${error.message}`);
  return { rows: (data ?? []) as StoredEvent[], total: count ?? 0 };
}

export async function trainingHistory(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const range = await resolvePeriod(admin, userId, { period: "last_7_days", ...args });
  const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
  const offset = Math.max(0, Number(args.offset) || 0);
  const { rows, total } = await readEvents(admin, userId, range, args, limit, offset);
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
    })),
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
  return {
    ...summary,
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
